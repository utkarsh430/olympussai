'use client';

import { useState } from 'react';
import {
  OpsAlert,
  OpsBadge,
  OpsButton,
  OpsEmptyState,
  OpsPanel,
  OpsReadout,
  OpsStack,
} from '@/components/ops/ui';
import {
  actionLabel,
  describeBasis,
  describeObjectiveCost,
  describeRejection,
  describeSampleAge,
  engineCommandSummary,
  humanOriginatedActions,
  isRecommendationExpired,
  matchingApproval,
  sampleAge,
  type PendingApproval,
  type RecommendationResult,
} from '@/lib/ops/recommendationView';
import type { EngineCandidateAction } from '@/models/control';

/**
 * What the decision engine proposes, why, and what its safety filter refused.
 *
 * ─── WHAT THIS REPLACED ──────────────────────────────────────────────────
 *
 * A free-text form. control-service has run a five-tier headway controller
 * since the core data model landed and nothing in the product had ever called
 * it; the control room's only way to act was to type an action type, a vehicle
 * registration and a route-direction uuid from memory. The intelligence was
 * built and unreachable. This panel is the reachable end of it.
 *
 * ─── WHAT IT REFUSES TO DO ───────────────────────────────────────────────
 *
 * Auto-issue. There is no path from a recommendation to a command that does
 * not go through a human dispatcher's approval and this operator's own
 * confirmation, and the console does not hold the authority to shortcut it:
 * `POST /api/ops/dispatcher/approvals` is dispatcher-only, so a control-room
 * operator structurally cannot approve their own proposal. What this panel
 * removes is the TYPING, not the second pair of eyes.
 *
 * The button therefore has two states and they are honest about which one the
 * operator is in:
 *
 *   • A pending dispatcher approval already authorizes this exact triple
 *     (action type, vehicle, corridor) — one click stages it, one confirms,
 *     and the fields sent are the approved ones verbatim.
 *   • No such approval exists — the control cannot issue anything and says
 *     what is missing, offering instead to prefill the command form so the
 *     operator still never types a uuid.
 *
 * The match is a convenience, never the authority. `POST .../commands`
 * re-checks the same triple field by field against the approval row
 * (APPROVAL_MISMATCH) and refuses on any disagreement. If this panel is wrong,
 * the server is still right.
 */

const DEFAULT_TTL_SECONDS = 120;

export interface EngineRecommendationPanelProps {
  routeDirectionId: string | null;
  result: RecommendationResult | null;
  loading: boolean;
  /** The last failure, already mapped to its code by the endpoint. */
  error: { code: string; message: string } | null;
  /** Pending dispatcher approvals, all action types — holds are not in the "disruptive" subset. */
  approvals: readonly PendingApproval[];
  /** Ticks with the console clock so ages re-render without their own timer. */
  now: number;
  /** Fill the command form with this proposal and show it. Used when no approval authorizes it yet. */
  onPrefillCommandForm: (prefill: {
    actionType: string;
    vehicleId: string;
    routeDirectionId: string;
    summary: string;
    dispatcherActionId?: string;
  }) => void;
  /** Ask the console to refresh every feed after a command lands. */
  onIssued: () => void;
  onRefresh: () => void;
}

export function EngineRecommendationPanel({
  routeDirectionId,
  result,
  loading,
  error,
  approvals,
  now,
  onPrefillCommandForm,
  onIssued,
  onRefresh,
}: EngineRecommendationPanelProps) {
  const [staged, setStaged] = useState<{ candidate: EngineCandidateAction; approvalId: string } | null>(null);
  const [ttlSeconds, setTtlSeconds] = useState(String(DEFAULT_TTL_SECONDS));
  const [issuing, setIssuing] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ commandId: string; status: string } | null>(null);

  if (routeDirectionId === null) {
    return (
      <OpsEmptyState>
        No corridor is selected, so there is nothing for the engine to solve. The control service reported no active
        route-directions.
      </OpsEmptyState>
    );
  }

  if (error) {
    return (
      <OpsStack gap="tight">
        <EngineErrorNotice error={error} />
        <OpsButton onClick={onRefresh}>Ask the engine again</OpsButton>
      </OpsStack>
    );
  }

  if (result === null) {
    return (
      <OpsEmptyState>{loading ? 'Asking the decision engine…' : 'No recommendation has been requested yet.'}</OpsEmptyState>
    );
  }

  const expired = isRecommendationExpired(result.solvedAt, now);
  const basis = describeBasis(result.selectionBasis, result.rejectedCandidates.length);
  const selected = result.selectedAction;
  const approval = selected ? matchingApproval(selected, approvals) : null;
  const halted = result.commandsBlockedBy;
  const alternatives = result.safeCandidates.filter(
    (candidate) => candidate !== selected && candidate.vehicleId !== selected?.vehicleId,
  );

  async function issue() {
    if (!staged || issuing) return;
    setIssuing(true);
    setIssueError(null);
    try {
      const response = await fetch('/api/ops/control-room/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dispatcherActionId: staged.approvalId,
          // Exactly the approved triple. Sent from the candidate the operator
          // is looking at, so a solve that refreshed underneath them cannot
          // silently retarget the command; the server's APPROVAL_MISMATCH
          // check independently proves the same thing.
          actionType: staged.candidate.actionType,
          vehicleId: staged.candidate.vehicleId,
          routeDirectionId: staged.candidate.routeDirectionId,
          parameters: { holdSeconds: staged.candidate.holdSeconds },
          ttlSeconds: Number(ttlSeconds),
          summary: engineCommandSummary(staged.candidate, result!.controllerVersion, result!.solvedAt),
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | { ok: true; commandId: string; status: string }
        | { error: { code: string; message: string } }
        | null;

      if (!response.ok || !data || !('ok' in data)) {
        setIssueError((data && 'error' in data && data.error.message) || 'Failed to issue this hold.');
        setIssuing(false);
        return;
      }
      setIssued({ commandId: data.commandId, status: data.status });
      setStaged(null);
      setIssuing(false);
      onIssued();
    } catch {
      setIssueError('Something went wrong issuing this hold. Please try again.');
      setIssuing(false);
    }
  }

  return (
    <OpsStack gap="tight">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <OpsBadge variant={expired ? 'critical' : 'live'}>{expired ? 'Expired' : 'Current'}</OpsBadge>
          <span className="font-mono text-[11px] text-ops-faint">
            solved {Math.max(0, Math.round((now - Date.parse(result.solvedAt)) / 1000))}s ago ·{' '}
            {result.controllerVersion}
          </span>
        </div>
        <OpsButton variant="quiet" onClick={onRefresh} disabled={loading}>
          {loading ? 'Solving…' : 'Re-solve now'}
        </OpsButton>
      </div>

      {expired && (
        <OpsAlert tone="warning" title="This recommendation has expired">
          The engine grades every candidate&apos;s freshness against the clock at the moment it solves, so a proposal
          left on screen carries a safety verdict that has since lapsed. It is still shown because an operator
          mid-decision should not have it vanish, but it can no longer be issued. Re-solve for a current answer.
        </OpsAlert>
      )}

      {issued && (
        <OpsAlert tone="success" title="Hold issued">
          Command <code className="font-mono">{issued.commandId}</code> — current status {issued.status}. Look it up
          under Approvals &amp; commands to follow the driver&apos;s acknowledgement.
        </OpsAlert>
      )}

      <OpsAlert tone={basis.tone === 'critical' ? 'error' : basis.tone === 'good' ? 'success' : 'info'} title={basis.headline}>
        {basis.detail}
      </OpsAlert>

      {halted && (
        <OpsAlert tone="error" title="Commands are halted for this corridor">
          {halted.scope === 'network'
            ? 'A network-wide kill switch is engaged, so the next command would be refused.'
            : `A kill switch is engaged for this route-direction, so the next command would be refused.`}{' '}
          Reason: {halted.reason}. The recommendation is still shown — an operator watching a halted route still needs
          to know what the engine thinks is happening.
        </OpsAlert>
      )}

      {selected ? (
        <OpsPanel
          tone="accent"
          title={`Proposed: ${actionLabel(selected.actionType)}`}
          description={`Vehicle ${selected.vehicleId} · hold ${Math.round(selected.holdSeconds)}s`}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <OpsReadout
              label="Headway deviation"
              value={`${Math.round(selected.headwayDeviationSeconds)}s`}
              tone={selected.headwayDeviationSeconds < 0 ? 'critical' : 'default'}
            />
            <OpsReadout label="Target headway" value={`${Math.round(selected.targetHeadwaySeconds)}s`} />
            <OpsReadout
              label="Reading age"
              // One call, both the words and the emphasis. A reading stamped
              // in the future is drawn as an alert rather than clamped to a
              // reassuring "0s" - see sampleAge in recommendationView.ts.
              value={describeSampleAge(sampleAge(selected.stateAsOf, now)).label}
              tone={describeSampleAge(sampleAge(selected.stateAsOf, now)).tone}
            />
            <OpsReadout label="Objective cost" value={String(Math.round(selected.objectiveCost))} />
          </div>

          <p className="mt-3 text-xs leading-relaxed text-ops-faint">
            {describeObjectiveCost(selected.objectiveCost)}. Depends on the live state of{' '}
            {selected.involvedVehicleIds.join(', ')}.{' '}
            {selected.headwayDeviationSeconds < 0
              ? 'A negative deviation means this bus has closed up on its leader.'
              : 'A positive deviation means this bus has fallen behind its target spacing.'}
          </p>

          <div className="mt-4 border-t border-ops-line pt-4">
            {issueError && (
              <p role="alert" className="mb-3 text-sm text-ops-danger">
                {issueError}
              </p>
            )}

            {staged ? (
              <div className="space-y-3">
                <p className="ops-label">Confirm before this reaches the driver</p>
                <div className="ops-well space-y-1 px-3 py-2 font-mono text-[11px] text-ops-muted">
                  <p>action: {staged.candidate.actionType}</p>
                  <p>vehicle: {staged.candidate.vehicleId}</p>
                  <p>route-direction: {staged.candidate.routeDirectionId}</p>
                  <p>approval: {staged.approvalId}</p>
                </div>
                <label htmlFor="engine-ttl" className="ops-label block">
                  Command TTL (seconds)
                </label>
                <input
                  id="engine-ttl"
                  type="number"
                  min={15}
                  max={900}
                  value={ttlSeconds}
                  onChange={(event) => setTtlSeconds(event.target.value)}
                  className="ops-input"
                />
                <div className="flex flex-wrap gap-2">
                  <OpsButton variant="primary" onClick={issue} disabled={issuing}>
                    {issuing ? 'Issuing…' : 'Confirm and issue'}
                  </OpsButton>
                  <OpsButton onClick={() => setStaged(null)} disabled={issuing}>
                    Cancel
                  </OpsButton>
                </div>
              </div>
            ) : approval && !halted && !expired ? (
              <div className="space-y-2">
                <OpsButton
                  variant="primary"
                  data-testid="engine-issue"
                  onClick={() => setStaged({ candidate: selected, approvalId: approval.id })}
                >
                  Issue this hold
                </OpsButton>
                <p className="text-xs text-ops-faint">
                  Dispatcher approval on file for this exact action ({approval.reason}). Nothing is typed and nothing is
                  auto-issued: you confirm, and the server re-checks the command against that approval before it
                  dispatches.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <OpsButton
                  data-testid="engine-prefill"
                  onClick={() =>
                    onPrefillCommandForm({
                      actionType: selected.actionType,
                      vehicleId: selected.vehicleId,
                      routeDirectionId: selected.routeDirectionId,
                      summary: engineCommandSummary(selected, result.controllerVersion, result.solvedAt),
                    })
                  }
                >
                  Prefill the command form
                </OpsButton>
                <p className="text-xs text-ops-faint">
                  {halted
                    ? 'Commands are halted for this corridor, so this cannot be issued now.'
                    : expired
                      ? 'This recommendation has expired and cannot be issued. Re-solve first.'
                      : `No dispatcher approval is on file for ${actionLabel(selected.actionType)} on ${selected.vehicleId} for this corridor, and a control-room operator cannot approve their own proposal. A dispatcher must approve it first; this fills the form so you still never type a uuid.`}
                </p>
              </div>
            )}
          </div>
        </OpsPanel>
      ) : null}
      {/* No "No action proposed" panel here on purpose. The banner above already
          carries the headline AND the reasoning for every no-selection case, and
          repeating the same paragraph immediately underneath it read as two
          separate findings when it is one. What follows a null selection that is
          worth reading is the rejection list, not a restatement. */}

      {result.rejectedCandidates.length > 0 && (
        <OpsPanel
          title={`Refused by the safety filter (${result.rejectedCandidates.length})`}
          description="Shown in full, never behind a disclosure: what the engine would not do is the evidence for what you decide instead."
        >
          <ul className="space-y-3">
            {result.rejectedCandidates.map((rejection, index) => (
              <li
                key={`${rejection.candidate.vehicleId}-${index}`}
                className="rounded-md border border-ops-line border-l-4 border-l-alert-amber px-3 py-2"
              >
                <p className="text-sm text-ops-ink">
                  {actionLabel(rejection.candidate.actionType)} on{' '}
                  <span className="font-mono">{rejection.candidate.vehicleId}</span> ·{' '}
                  {Math.round(rejection.candidate.holdSeconds)}s
                </p>
                <ul className="mt-1 space-y-1">
                  {rejection.reasons.map((reason) => (
                    <li key={reason} className="text-xs leading-relaxed text-ops-warn">
                      {describeRejection(reason, rejection.candidate, result.constraints)}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </OpsPanel>
      )}

      {alternatives.length > 0 && (
        <OpsPanel
          title={`Other safe options (${alternatives.length})`}
          description="Survived the safety filter but ranked below the proposal, in the engine's own priority order."
        >
          <ul className="space-y-2">
            {alternatives.map((candidate) => (
              <li key={candidate.vehicleId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-ops-ink">
                  {actionLabel(candidate.actionType)} on <span className="font-mono">{candidate.vehicleId}</span>
                </span>
                <span className="font-mono text-xs text-ops-faint">
                  {Math.round(candidate.holdSeconds)}s · cost {Math.round(candidate.objectiveCost)}
                </span>
              </li>
            ))}
          </ul>
        </OpsPanel>
      )}

      <PredictiveAdvisoryPanel advisory={result.predictiveAdvisory} selectedVehicleId={selected?.vehicleId ?? null} />

      <EngineScopePanel engineActionTypes={result.engineActionTypes} />

      <p className="text-[11px] leading-relaxed text-ops-faint">
        This solve is not written down anywhere — the engine was asked and answered, and nothing was persisted. It is
        not an audited record, and there is no history of it to open. The command you issue from it is audited; the
        proposal behind it survives only in that command&apos;s summary.
      </p>
    </OpsStack>
  );
}

/**
 * The advisory, kept structurally apart from the thing that can commit.
 *
 * It is an occupancy-weighted re-score that cannot select — nothing in the
 * solver can promote its ranking into `selectedAction` — and it routinely
 * ranks a DIFFERENT bus first. Presented as a second opinion of equal standing
 * it would invite an operator to "go with the other one", which is a choice the
 * system never modelled. So: separate panel, PREDICTIVE label kept visible, no
 * issue control of any kind, and no prefill.
 */
function PredictiveAdvisoryPanel({
  advisory,
  selectedVehicleId,
}: {
  advisory: RecommendationResult['predictiveAdvisory'];
  selectedVehicleId: string | null;
}) {
  const top = advisory.candidates[0];
  const disagrees = top !== undefined && selectedVehicleId !== null && top.vehicleId !== selectedVehicleId;

  return (
    <OpsPanel
      title="Predictive advisory"
      actions={<OpsBadge variant="sim">{advisory.label}</OpsBadge>}
      description="Advisory only. It re-scores the safe candidates by estimated occupancy and cannot select or issue anything."
    >
      {advisory.candidates.length === 0 ? (
        <p className="text-sm text-ops-muted">No advisory candidates for this corridor.</p>
      ) : (
        <>
          <ul className="space-y-2">
            {advisory.candidates.map((candidate) => (
              <li key={candidate.vehicleId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-ops-ink">
                  {actionLabel(candidate.actionType)} on <span className="font-mono">{candidate.vehicleId}</span>
                  {candidate.occupancyEstimated && (
                    <span className="ml-2 text-[11px] text-ops-warn">occupancy estimated, not measured</span>
                  )}
                </span>
                <span className="font-mono text-xs text-ops-faint">
                  score {candidate.mpcObjectiveCost.toFixed(1)}
                </span>
              </li>
            ))}
          </ul>
          {disagrees && (
            <p className="mt-3 text-xs leading-relaxed text-ops-warn">
              This advisory ranks {top.vehicleId} first, which is not the bus the engine proposed. That disagreement is
              normal and is not a tie to break: only the proposal above went through the safety filter and the
              selection policy.
            </p>
          )}
          <p className="mt-3 text-[11px] leading-relaxed text-ops-faint">
            {advisory.horizonControlPoints} control points is the configured horizon, not a horizon this advisory
            actually simulated — it is a single-step re-score today.
          </p>
        </>
      )}
    </OpsPanel>
  );
}

/**
 * The engine's vocabulary, stated from the response rather than from memory.
 *
 * The six instructions the engine cannot propose still exist and are still
 * issuable by a human, and an operator has to be able to tell which is which
 * without being told twice. Deriving the split from `engineActionTypes` means
 * this claim cannot outlive its truth.
 */
function EngineScopePanel({ engineActionTypes }: { engineActionTypes: readonly string[] }) {
  const human = humanOriginatedActions(engineActionTypes);
  return (
    <OpsPanel title="What this engine can and cannot propose">
      <p className="text-xs leading-relaxed text-ops-muted">
        The decision engine only ever proposes holds:{' '}
        <span className="text-ops-ink">{engineActionTypes.map(actionLabel).join(', ')}</span>.
      </p>
      <p className="mt-2 text-xs leading-relaxed text-ops-muted">
        The other {human.length} instructions — <span className="text-ops-ink">{human.map(actionLabel).join(', ')}</span>{' '}
        — are issuable, but nothing in this system generates or ranks them. Choosing one is entirely a human judgement,
        and no model has evaluated it.
      </p>
    </OpsPanel>
  );
}

/**
 * Engine failures, told apart.
 *
 * `NO_ACTIVE_POLICY` is not a fault and not retryable: the corridor has no
 * active `route_policies` row, so there is no target headway and no control law
 * can run. Rendering it as "no recommendation" would read as "nothing to do",
 * when the fix is a policy. `CONTROL_SERVICE_UNAVAILABLE` must never render as
 * "no action needed" either — the engine may well have wanted to act.
 */
function EngineErrorNotice({ error }: { error: { code: string; message: string } }) {
  if (error.code === 'NO_ACTIVE_POLICY') {
    return (
      <OpsAlert tone="warning" title="No control policy is configured for this corridor">
        There is no active route policy here, so there is no target headway to regulate toward and no control law can
        run. This is a configuration gap, not a fault and not a quiet corridor — the engine was never able to form an
        opinion. Retrying will not change it.
      </OpsAlert>
    );
  }
  if (error.code === 'CONTROL_SERVICE_UNAVAILABLE' || error.code === 'NOT_CONFIGURED') {
    return (
      <OpsAlert tone="error" title="The decision engine is unreachable">
        No recommendation is available right now. This is not &quot;no action needed&quot; — the engine may have wanted
        to act and could not be asked. Bunching detection and the tables on this console are unaffected.
      </OpsAlert>
    );
  }
  if (error.code === 'CONTROL_SERVICE_ERROR') {
    // Off-contract, which in practice almost always means a VERSION SKEW: the
    // console requires the solver to name the candidate it selected and the
    // set that survived the safety filter, and a control service older than
    // that change answers without them. The console refuses the answer rather
    // than re-deriving the selection itself — a second copy of that rule could
    // name a different bus than the solver did, on a control path. Saying
    // "unreachable" here would send someone to check a service that is up.
    return (
      <OpsAlert tone="error" title="The engine answered in a shape this console will not accept">
        The response did not match the contract, so it was refused rather than interpreted. The usual cause is a
        control service older than this console: naming the selected action and the candidates that passed the safety
        filter is what lets the console show a proposal without re-deriving the engine&apos;s own choice. Detection,
        incidents and every other panel here are unaffected. ({error.message})
      </OpsAlert>
    );
  }
  return (
    <OpsAlert tone="error" title="The engine could not answer">
      {error.message}
    </OpsAlert>
  );
}
