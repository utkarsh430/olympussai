'use client';

import { useState } from 'react';
import {
  OpsAlert,
  OpsBadge,
  OpsButton,
  OpsEmptyState,
  OpsField,
  OpsIdentifier,
  OpsInput,
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
 * What the engine suggests, why, and what its safety checks refused.
 *
 * ─── WHAT IT REFUSES TO DO ───────────────────────────────────────────────
 *
 * Send anything by itself. There is no path from a suggestion to an
 * instruction that does not go through a dispatcher's approval and this
 * operator's own confirmation, and the console does not hold the authority to
 * shortcut it: `POST /api/ops/dispatcher/approvals` is dispatcher-only, so a
 * control-room operator structurally cannot approve their own suggestion. What
 * this panel removes is the TYPING, not the second pair of eyes.
 *
 * The button therefore has two states and they are honest about which one the
 * operator is in:
 *
 *   • A waiting approval already allows this exact triple (instruction, bus,
 *     corridor) — one click stages it, one confirms, and the fields sent are
 *     the approved ones verbatim.
 *   • No such approval exists — the control cannot send anything and says what
 *     is missing, offering instead to fill in the send form so the operator
 *     still never types a reference.
 *
 * The match is a convenience, never the authority. `POST .../commands`
 * re-checks the same triple field by field against the approval row
 * (APPROVAL_MISMATCH) and refuses on any disagreement. If this panel is wrong,
 * the server is still right.
 *
 * ─── AND WHAT IT MUST NEVER IMPLY ────────────────────────────────────────
 *
 * That the engine can suggest anything other than the three hold types. The
 * "What this engine can and cannot suggest" panel at the bottom derives that
 * claim from `engineActionTypes` on the response itself rather than restating
 * it, so it cannot outlive its truth if the solver ever learns a fourth.
 */

const DEFAULT_TTL_SECONDS = 120;

export interface EngineRecommendationPanelProps {
  routeDirectionId: string | null;
  result: RecommendationResult | null;
  loading: boolean;
  /** The last failure, already mapped to its code by the endpoint. */
  error: { code: string; message: string } | null;
  /** Approvals waiting for a decision, all instruction types — holds are not in the "disruptive" subset. */
  approvals: readonly PendingApproval[];
  /** Ticks with the console clock so ages re-render without their own timer. */
  now: number;
  /** Fill the send form with this suggestion and show it. Used when no approval allows it yet. */
  onPrefillCommandForm: (prefill: {
    actionType: string;
    vehicleId: string;
    routeDirectionId: string;
    summary: string;
    dispatcherActionId?: string;
  }) => void;
  /** Ask the console to refresh every feed after an instruction lands. */
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
  const [staged, setStaged] = useState<{
    candidate: EngineCandidateAction;
    approvalId: string;
  } | null>(null);
  const [ttlSeconds, setTtlSeconds] = useState(String(DEFAULT_TTL_SECONDS));
  const [issuing, setIssuing] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ commandId: string; status: string } | null>(null);

  if (routeDirectionId === null) {
    return (
      <OpsEmptyState>
        No corridor is chosen, so there is nothing to work out. The control service reported no
        corridors.
      </OpsEmptyState>
    );
  }

  if (error) {
    return (
      <OpsStack gap="tight">
        <EngineErrorNotice error={error} />
        <OpsButton onClick={onRefresh}>Try again</OpsButton>
      </OpsStack>
    );
  }

  if (result === null) {
    return (
      <OpsEmptyState>
        {loading ? 'Working out a suggestion…' : 'Nothing has been worked out yet.'}
      </OpsEmptyState>
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
          // silently retarget the instruction; the server's APPROVAL_MISMATCH
          // check independently proves the same thing.
          actionType: staged.candidate.actionType,
          vehicleId: staged.candidate.vehicleId,
          routeDirectionId: staged.candidate.routeDirectionId,
          parameters: { holdSeconds: staged.candidate.holdSeconds },
          ttlSeconds: Number(ttlSeconds),
          summary: engineCommandSummary(
            staged.candidate,
            result!.controllerVersion,
            result!.solvedAt,
          ),
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | { ok: true; commandId: string; status: string }
        | { error: { code: string; message: string } }
        | null;

      if (!response.ok || !data || !('ok' in data)) {
        setIssueError(
          (data && 'error' in data && data.error.message) || 'The hold was not sent. Try again.',
        );
        setIssuing(false);
        return;
      }
      setIssued({ commandId: data.commandId, status: data.status });
      setStaged(null);
      setIssuing(false);
      onIssued();
    } catch {
      setIssueError('The hold was not sent — the console could not be reached. Try again.');
      setIssuing(false);
    }
  }

  return (
    <OpsStack gap="tight">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <OpsBadge variant={expired ? 'critical' : 'live'}>
            {expired ? 'Out of date' : 'Current'}
          </OpsBadge>
          <span className="text-[11px] tabular-nums text-subtle">
            worked out {Math.max(0, Math.round((now - Date.parse(result.solvedAt)) / 1000))}s ago ·
            engine {result.controllerVersion}
          </span>
        </div>
        <OpsButton variant="quiet" onClick={onRefresh} disabled={loading}>
          {loading ? 'Working…' : 'Check again now'}
        </OpsButton>
      </div>

      {expired && (
        <OpsAlert tone="warning" title="This suggestion is out of date">
          The engine judges how fresh each bus&apos;s position is against the clock at the moment it
          works the answer out, so a suggestion left on screen carries a safety judgement that has
          since lapsed. It is still shown because an operator part-way through a decision should not
          have it vanish, but it can no longer be sent. Check again for a current answer.
        </OpsAlert>
      )}

      {issued && (
        <OpsAlert tone="success" title="Hold sent">
          Reference <OpsIdentifier>{issued.commandId}</OpsIdentifier> — current state{' '}
          {issued.status}. Look it up under &ldquo;Send an instruction&rdquo; to follow the
          driver&apos;s answer.
        </OpsAlert>
      )}

      <OpsAlert
        tone={basis.tone === 'critical' ? 'error' : basis.tone === 'good' ? 'success' : 'info'}
        title={basis.headline}
      >
        {basis.detail}
      </OpsAlert>

      {halted && (
        <OpsAlert tone="error" title="New instructions are stopped for this corridor">
          {halted.scope === 'network'
            ? 'New instructions are stopped across the whole state, so the next one would be refused.'
            : 'New instructions are stopped on this corridor, so the next one would be refused.'}{' '}
          Reason: {halted.reason}. The suggestion is still shown — an operator watching a stopped
          corridor still needs to know what the engine thinks is happening.
        </OpsAlert>
      )}

      {selected ? (
        <OpsPanel
          tone="accent"
          title={`Suggested: ${actionLabel(selected.actionType)}`}
          description={`Bus ${selected.vehicleId} · hold ${Math.round(selected.holdSeconds)}s`}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <OpsReadout
              label="Gap difference"
              value={`${Math.round(selected.headwayDeviationSeconds)}s`}
              tone={selected.headwayDeviationSeconds < 0 ? 'critical' : 'default'}
            />
            <OpsReadout
              label="Planned gap"
              value={`${Math.round(selected.targetHeadwaySeconds)}s`}
            />
            <OpsReadout
              label="How old this reading is"
              // One call, both the words and the emphasis. A reading stamped
              // in the future is drawn as an alert rather than clamped to a
              // reassuring "0s" - see sampleAge in recommendationView.ts.
              value={describeSampleAge(sampleAge(selected.stateAsOf, now)).label}
              tone={describeSampleAge(sampleAge(selected.stateAsOf, now)).tone}
            />
            <OpsReadout
              label="Distance from the ideal hold"
              value={String(Math.round(selected.objectiveCost))}
            />
          </div>

          <p className="mt-3 text-xs leading-relaxed text-subtle">
            {describeObjectiveCost(selected.objectiveCost)}. Depends on where{' '}
            {selected.involvedVehicleIds.join(', ')}{' '}
            {selected.involvedVehicleIds.length === 1 ? 'is' : 'are'} right now.{' '}
            {selected.headwayDeviationSeconds < 0
              ? 'A minus figure means this bus has closed up on the bus in front.'
              : 'A plus figure means this bus has dropped further behind than planned.'}
          </p>

          <div className="mt-4 border-t border-border pt-4">
            {issueError && (
              <OpsAlert tone="error" className="mb-3">
                {issueError}
              </OpsAlert>
            )}

            {staged ? (
              <div className="space-y-3">
                <p className="ops-label">Check this before it reaches the driver</p>
                <dl className="ops-well space-y-1 px-3 py-2 text-xs text-muted-foreground">
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0">Instruction</dt>
                    <dd className="text-foreground">{actionLabel(staged.candidate.actionType)}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0">Bus</dt>
                    <dd className="text-foreground">
                      <OpsIdentifier>{staged.candidate.vehicleId}</OpsIdentifier>
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0">Hold for</dt>
                    <dd className="text-foreground">{Math.round(staged.candidate.holdSeconds)}s</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-24 shrink-0">Approved under</dt>
                    <dd className="min-w-0 break-all text-foreground">
                      <OpsIdentifier>{staged.approvalId}</OpsIdentifier>
                    </dd>
                  </div>
                </dl>
                <OpsField
                  label="How long the driver has to answer"
                  htmlFor="engine-ttl"
                  hint="In seconds. After this the instruction expires on its own."
                >
                  <OpsInput
                    id="engine-ttl"
                    type="number"
                    min={15}
                    max={900}
                    value={ttlSeconds}
                    onChange={(event) => setTtlSeconds(event.target.value)}
                  />
                </OpsField>
                <div className="flex flex-wrap gap-2">
                  <OpsButton variant="primary" onClick={issue} disabled={issuing}>
                    {issuing ? 'Sending…' : 'Confirm and send'}
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
                  Send this hold
                </OpsButton>
                <p className="text-xs text-subtle">
                  A dispatcher has already approved this exact action ({approval.reason}). Nothing
                  is typed and nothing is sent on its own: you confirm it, and the server checks the
                  instruction against that approval again before it goes out.
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
                      summary: engineCommandSummary(
                        selected,
                        result.controllerVersion,
                        result.solvedAt,
                      ),
                    })
                  }
                >
                  Fill in the send form
                </OpsButton>
                <p className="text-xs text-subtle">
                  {halted
                    ? 'New instructions are stopped for this corridor, so this cannot be sent now.'
                    : expired
                      ? 'This suggestion is out of date and cannot be sent. Check again first.'
                      : `No dispatcher has approved ${actionLabel(selected.actionType)} on ${selected.vehicleId} for this corridor, and a control-room operator cannot approve their own suggestion. A dispatcher has to approve it first; this fills in the form so you still never type a reference.`}
                </p>
              </div>
            )}
          </div>
        </OpsPanel>
      ) : null}
      {/* No "Nothing suggested" panel here on purpose. The banner above already
          carries the headline AND the reasoning for every no-selection case, and
          repeating the same paragraph immediately underneath it read as two
          separate findings when it is one. What follows a null selection that is
          worth reading is the refused list, not a restatement. */}

      {result.rejectedCandidates.length > 0 && (
        <OpsPanel
          title={`Refused by the safety checks (${result.rejectedCandidates.length})`}
          description="Shown in full, never folded away: what the engine would not do is the evidence for what you decide instead."
        >
          <ul className="space-y-3">
            {result.rejectedCandidates.map((rejection, index) => (
              <li
                key={`${rejection.candidate.vehicleId}-${index}`}
                className="rounded-md border border-l-4 border-border border-l-warning px-3 py-2"
              >
                <p className="text-sm text-foreground">
                  {actionLabel(rejection.candidate.actionType)} on{' '}
                  <OpsIdentifier>{rejection.candidate.vehicleId}</OpsIdentifier> ·{' '}
                  {Math.round(rejection.candidate.holdSeconds)}s
                </p>
                <ul className="mt-1 space-y-1">
                  {rejection.reasons.map((reason) => (
                    <li key={reason} className="text-xs leading-relaxed text-warning">
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
          title={`Other options that passed the safety checks (${alternatives.length})`}
          description="These passed the safety checks but ranked below the suggestion, in the engine's own order of preference."
        >
          <ul className="space-y-2">
            {alternatives.map((candidate) => (
              <li
                key={candidate.vehicleId}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <span className="text-foreground">
                  {actionLabel(candidate.actionType)} on{' '}
                  <OpsIdentifier>{candidate.vehicleId}</OpsIdentifier>
                </span>
                <span className="text-xs tabular-nums text-subtle">
                  {Math.round(candidate.holdSeconds)}s · {Math.round(candidate.objectiveCost)}s from
                  the ideal hold
                </span>
              </li>
            ))}
          </ul>
        </OpsPanel>
      )}

      <PredictiveAdvisoryPanel
        advisory={result.predictiveAdvisory}
        selectedVehicleId={selected?.vehicleId ?? null}
      />

      <EngineScopePanel engineActionTypes={result.engineActionTypes} />

      <p className="text-[11px] leading-relaxed text-subtle">
        This suggestion is not saved anywhere. The engine was asked, it answered, and nothing was
        written down — there is no history of it to open. The instruction you send from it{' '}
        <strong className="font-semibold">is</strong> recorded, and the suggestion behind it
        survives only in that instruction&apos;s reason.
      </p>
    </OpsStack>
  );
}

/**
 * The second opinion, kept structurally apart from the thing that can commit.
 *
 * It re-ranks by an estimate of how full each bus is, it cannot select —
 * nothing in the solver can promote its ranking into `selectedAction` — and it
 * routinely ranks a DIFFERENT bus first. Presented as an equal it would invite
 * an operator to "go with the other one", which is a choice the system never
 * modelled. So: separate panel, its own chip, no send control of any kind, and
 * no fill-in.
 */
function PredictiveAdvisoryPanel({
  advisory,
  selectedVehicleId,
}: {
  advisory: RecommendationResult['predictiveAdvisory'];
  selectedVehicleId: string | null;
}) {
  const top = advisory.candidates[0];
  const disagrees =
    top !== undefined && selectedVehicleId !== null && top.vehicleId !== selectedVehicleId;

  return (
    <OpsPanel
      title="Second opinion, weighted by how full the buses are"
      actions={<OpsBadge variant="sim">Second opinion</OpsBadge>}
      description="It re-ranks the options that passed the safety checks by an estimate of how full each bus is. It cannot choose or send anything."
    >
      {advisory.candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">No second opinion for this corridor.</p>
      ) : (
        <>
          <ul className="space-y-2">
            {advisory.candidates.map((candidate) => (
              <li
                key={candidate.vehicleId}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <span className="text-foreground">
                  {actionLabel(candidate.actionType)} on{' '}
                  <OpsIdentifier>{candidate.vehicleId}</OpsIdentifier>
                  {candidate.occupancyEstimated && (
                    <span className="ml-2 text-[11px] text-warning">
                      how full it is has been estimated, not measured
                    </span>
                  )}
                </span>
                <span className="text-xs tabular-nums text-subtle">
                  ranking score {candidate.mpcObjectiveCost.toFixed(1)}
                </span>
              </li>
            ))}
          </ul>
          {disagrees && (
            <p className="mt-3 text-xs leading-relaxed text-warning">
              This second opinion puts {top.vehicleId} first, which is not the bus the engine
              suggested. That disagreement is normal and is not a tie to break: only the suggestion
              above went through the safety checks and the rules for choosing.
            </p>
          )}
          <p className="mt-3 text-[11px] leading-relaxed text-subtle">
            The {advisory.horizonControlPoints}-stop look-ahead is a setting, not something this
            second opinion actually worked through. Today it re-ranks one step ahead only.
          </p>
        </>
      )}
    </OpsPanel>
  );
}

/**
 * The engine's vocabulary, stated from the response rather than from memory.
 *
 * The six instructions the engine cannot suggest still exist and are still
 * sendable by a person, and an operator has to be able to tell which is which
 * without being told twice. Deriving the split from `engineActionTypes` means
 * this claim cannot outlive its truth: if the solver ever learns a fourth
 * action, this panel stops calling it human-only on its own, with no edit here.
 */
function EngineScopePanel({ engineActionTypes }: { engineActionTypes: readonly string[] }) {
  const human = humanOriginatedActions(engineActionTypes);
  return (
    <OpsPanel title="What this engine can and cannot suggest">
      <p className="text-xs leading-relaxed text-muted-foreground">
        The engine only ever suggests holds:{' '}
        <span className="text-foreground">{engineActionTypes.map(actionLabel).join(', ')}</span>.
      </p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        The other {human.length} instructions —{' '}
        <span className="text-foreground">{human.map(actionLabel).join(', ')}</span> — can be sent,
        but nothing in this system works them out or ranks them. Choosing one is entirely a
        person&apos;s judgement, and no model has looked at it.
      </p>
    </OpsPanel>
  );
}

/**
 * Engine failures, told apart.
 *
 * `NO_ACTIVE_POLICY` is not a fault and not retryable: the corridor has no
 * planned gap, so there is nothing to correct toward and the automatic spacing
 * rules cannot run. Rendering it as "nothing suggested" would read as "nothing
 * to do", when the fix is a setting. `CONTROL_SERVICE_UNAVAILABLE` must never
 * render as "no action needed" either — the engine may well have wanted to act.
 */
function EngineErrorNotice({ error }: { error: { code: string; message: string } }) {
  if (error.code === 'NO_ACTIVE_POLICY') {
    return (
      <OpsAlert tone="warning" title="No planned gap is set for this corridor">
        Without a planned gap there is nothing to correct toward, so the automatic spacing rules
        cannot run. This is a setting that has not been filled in — not a fault, and not a quiet
        corridor. The engine was never able to form an opinion, and trying again will not change it.
      </OpsAlert>
    );
  }
  if (error.code === 'CONTROL_SERVICE_UNAVAILABLE' || error.code === 'NOT_CONFIGURED') {
    return (
      <OpsAlert tone="error" title="The engine cannot be reached">
        No suggestion is available right now. This is not &quot;nothing needs doing&quot; — the
        engine may have wanted to act and could not be asked. Buses closing up and the tables on
        this console are unaffected.
      </OpsAlert>
    );
  }
  if (error.code === 'CONTROL_SERVICE_ERROR') {
    // Off-contract, which in practice almost always means a VERSION SKEW: the
    // console requires the solver to name the option it chose and the set that
    // passed the safety checks, and a control service older than that change
    // answers without them. The console refuses the answer rather than
    // re-deriving the choice itself — a second copy of that rule could name a
    // different bus than the solver did, on a control path. Saying
    // "unreachable" here would send someone to check a service that is up.
    return (
      <OpsAlert tone="error" title="This screen could not read the engine's answer">
        The answer did not have the shape this screen expects, so it was refused rather than guessed
        at. Usually this means the control service is an older version than this screen. Report it —
        trying again will not help. Buses closing up and every other panel here still work. (
        {error.message})
      </OpsAlert>
    );
  }
  return (
    <OpsAlert tone="error" title="The engine could not answer">
      {error.message}
    </OpsAlert>
  );
}
