'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  OpsAlert,
  OpsButton,
  OpsEmptyState,
  OpsIdentifier,
  OpsPanel,
  OpsReadout,
  OpsStack,
} from '@/components/ops/ui';
import {
  actionLabel,
  describeBoardingLimitAvailability,
  describeRejection,
  type RecommendationResult,
} from '@/lib/ops/recommendationView';
import type { BunchingAlert, EngineCandidateAction } from '@/models/control';
import { memberSummary } from './AlertRow';

/**
 * What to do about ONE alert, worked out on demand.
 *
 * ─── WHY THE SOLVE IS ON DEMAND AND NOT ON THE LIST ──────────────────────
 *
 * Detection is standing and cheap; solving is neither. Running the control
 * laws for every open alert as the inbox rendered would solve the whole
 * network on every glance, and each proposal carries a freshness verdict the
 * safety filter grades against the wall clock (90 s) - so most of those
 * solves would expire unread. Worse, they would expire INVISIBLY, leaving a
 * list of stale holds that all still looked actionable.
 *
 * So the operator asks, per alert, and gets an answer computed at the moment
 * they asked it. That is also why there is no auto-refresh here: a proposal
 * that silently replaced itself under the operator's cursor is how the wrong
 * bus gets held.
 *
 * ─── WHY THIS PROPOSES BUT DOES NOT SEND ─────────────────────────────────
 *
 * There is no path from this panel to a `commands` row. Issuing needs a
 * dispatcher's approval and the APPROVAL_MISMATCH cross-check, and a
 * control-room operator structurally cannot approve their own proposal
 * (`POST /api/ops/dispatcher/approvals` is dispatcher-only). The console owns
 * that flow already, with the approval matching and the two-step confirm; the
 * hand-off below is a deep link into it rather than a second implementation
 * of it. A second implementation is exactly the drift a safety-relevant path
 * must not have.
 */
export function AlertSolutionPanel({ alert }: { alert: BunchingAlert }) {
  const [result, setResult] = useState<RecommendationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  // A new alert is a new question. Carrying the previous alert's proposal
  // across the selection change would show a hold for a bus on another
  // corridor under this alert's heading.
  useEffect(() => {
    setResult(null);
    setError(null);
    setLoading(false);
  }, [alert.id]);

  const seekSolution = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/ops/control-room/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ routeDirectionId: alert.routeDirectionId }),
      });
      const data = (await response.json().catch(() => null)) as
        | RecommendationResult
        | { error: { code: string; message: string } }
        | null;

      if (!response.ok || !data || 'error' in data) {
        setResult(null);
        setError(
          data && 'error' in data
            ? data.error
            : { code: 'UNKNOWN', message: 'The decision engine could not be asked.' },
        );
        return;
      }
      setResult(data);
    } catch {
      setResult(null);
      setError({ code: 'UNREACHABLE', message: 'The decision engine could not be reached.' });
    } finally {
      setLoading(false);
    }
  }, [alert.routeDirectionId]);

  const { front, behind } = memberSummary(alert.members);

  return (
    <OpsPanel title="What to do about it">
      <OpsStack gap="tight">
        <div className="text-sm">
          <span className="font-medium">{alert.routePublicName}</span>
          <span className="text-muted-foreground">
            {' '}
            · {alert.directionName ?? alert.directionCode}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {front ? (
            <>
              <span>In front</span> <OpsIdentifier>{front}</OpsIdentifier>
            </>
          ) : null}
          {behind ? (
            <>
              <span>· Behind</span> <OpsIdentifier>{behind}</OpsIdentifier>
            </>
          ) : null}
        </div>

        {result === null && error === null ? (
          <OpsStack gap="tight">
            <OpsEmptyState>
              {loading
                ? 'Working out what would fix this…'
                : 'Nothing has been worked out for this alert yet.'}
            </OpsEmptyState>
            <OpsButton variant="primary" onClick={seekSolution} disabled={loading}>
              {loading ? 'Working…' : 'Work out a solution'}
            </OpsButton>
          </OpsStack>
        ) : null}

        {error ? (
          <OpsStack gap="tight">
            <OpsAlert tone="warning" title="The engine could not be asked">
              {error.message}
            </OpsAlert>
            <OpsButton onClick={seekSolution} disabled={loading}>
              Try again
            </OpsButton>
          </OpsStack>
        ) : null}

        {result ? (
          <ProposedSolution result={result} routeDirectionId={alert.routeDirectionId} onRedo={seekSolution} loading={loading} />
        ) : null}
      </OpsStack>
    </OpsPanel>
  );
}

/**
 * The proposal, stated against the three priorities it was decided by.
 *
 * ─── WHY THE THREE ARE BROKEN OUT ────────────────────────────────────────
 *
 * `objectiveCost` is one number in passenger-seconds and it is the sum of
 * four terms that pull in different directions: waiting saved at the stops
 * ahead, delay added to the people already aboard, the operator's cost of
 * standing still, and the punctuality the hold spends. An operator asked to
 * act on the sum alone cannot tell whether a hold is cheap because it helps a
 * lot or because it costs little, and those justify very different amounts of
 * confidence.
 *
 * The operator's stated priorities are even spacing, punctuality, and
 * passenger distribution. Those are three of these four terms, so they are
 * shown as three lines rather than folded into one.
 */
function ProposedSolution({
  result,
  routeDirectionId,
  onRedo,
  loading,
}: {
  result: RecommendationResult;
  routeDirectionId: string;
  onRedo: () => void;
  loading: boolean;
}) {
  const action = result.selectedAction;

  if (!action) {
    const rejected = result.rejectedCandidates ?? [];
    return (
      <OpsStack gap="tight">
        {rejected.length > 0 ? (
          <OpsAlert tone="warning" title="The engine proposed nothing, and that is a finding">
            <p className="mb-2">
              The control laws did produce actions and every one was refused by the safety checks.
              This is not &ldquo;nothing is wrong&rdquo; — it is the engine declining to act on
              inputs it does not trust.
            </p>
            <ul className="list-disc space-y-1 pl-4">
              {rejected.slice(0, 4).map((r, i) => (
                <li key={i}>
                  {actionLabel(r.candidate.actionType)} on {r.candidate.vehicleId}:{' '}
                  {r.reasons
                    .map((reason) => describeRejection(reason, r.candidate, result.constraints ?? {}))
                    .join(' ')}
                </li>
              ))}
            </ul>
          </OpsAlert>
        ) : (
          <OpsAlert tone="info" title="No hold would help here">
            No control law produced an action for this corridor. The buses are spaced at or beyond
            target, or there is no bus in a position to be held.
          </OpsAlert>
        )}
        <AlternativeActions result={result} />
        <OpsButton onClick={onRedo} disabled={loading}>
          Work it out again
        </OpsButton>
      </OpsStack>
    );
  }

  return (
    <OpsStack gap="tight">
      <OpsAlert tone="info" title={`Hold ${action.vehicleId} for ${Math.round(action.holdSeconds)} seconds`}>
        {action.rationale}
      </OpsAlert>

      <PriorityBreakdown action={action} />

      <AlternativeActions result={result} />

      <OpsStack gap="tight">
        {/*
          The hand-off. Issuing lives in the console because that is where the
          approval matching and the two-step confirm already are; duplicating
          them here would put a second copy of a safety-relevant rule in the
          codebase.
        */}
        <Link
          href={`/ops/control-room?tab=decisions&routeDirectionId=${encodeURIComponent(routeDirectionId)}`}
          className="ops-button-primary inline-flex items-center justify-center"
        >
          Take this to the console to send it
        </Link>
        <OpsButton variant="quiet" onClick={onRedo} disabled={loading}>
          Work it out again
        </OpsButton>
      </OpsStack>
    </OpsStack>
  );
}

/**
 * The options the engine will not choose for you.
 *
 * ─── WHY THESE ARE SHOWN SEPARATELY FROM THE PROPOSAL ────────────────────
 *
 * Both of these fix bunching WITHOUT adding delay, which is exactly the
 * combination the operator asked for — and neither can be ranked against the
 * holds on the engine's own scale.
 *
 *  - Alighting-only ("let people off, take nobody on") has a cost the engine
 *    can estimate — the passengers left standing — and a benefit it cannot:
 *    the dwell the leader sheds needs a dwell model no corridor has fitted
 *    yet. Sorted against the holds it would come last every time, which reads
 *    as "considered and rejected" when the truth is "nobody measured the
 *    upside".
 *  - Easing off spends slack the bus already has. It is not an instruction
 *    with a hold length, so it is not a candidate at all.
 *
 * Presenting them as alternatives rather than burying them in a ranking is
 * the honest shape: the engine has done the arithmetic it can do and is
 * handing the judgement back.
 */
function AlternativeActions({ result }: { result: RecommendationResult }) {
  const boardingLimits = result.boardingLimitCandidates ?? [];
  const paceAdvisories = result.paceAdvisories ?? [];
  // Rendered whether or not there are proposals, and that is the point: on
  // every corridor on this network alighting-only is switched off, so its
  // candidate list is empty for a REASON, and "the engine found nothing" and
  // "the engine found something and may not offer it" must not look alike.
  // Null only when the control service predates the gate and cannot say.
  const availability = describeBoardingLimitAvailability(result.boardingLimitAvailability);

  if (boardingLimits.length === 0 && paceAdvisories.length === 0 && availability === null) {
    return null;
  }

  return (
    <div className="ops-well px-4 py-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
        Alternatives that cost no delay
      </p>
      <OpsStack gap="tight">
        {availability && (
          <div
            className={
              availability.tone === 'warn'
                ? 'rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2'
                : 'rounded border border-border px-3 py-2'
            }
          >
            <p className="text-sm font-medium">{availability.headline}</p>
            <p className="mt-1 text-xs text-muted-foreground">{availability.detail}</p>
          </div>
        )}

        {boardingLimits.map((candidate) => (
          <div key={`bl-${candidate.vehicleId}`}>
            <p className="text-sm font-medium">
              Let passengers off <OpsIdentifier>{candidate.vehicleId}</OpsIdentifier> but take none
              on
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{candidate.rationale}</p>
            {/*
              The WAIT is stated and the passenger count is not, because only
              one of them is measured. Under the current arrival-rate
              placeholder any passenger figure is an artefact — a live solve
              produced 0.0007 — and "about 1 passenger" at a stop with forty
              people waiting is the most quotable wrong number this page could
              carry. The wait is real, and it is the number an operator
              actually weighs.
            */}
            <p className="mt-1 text-xs text-muted-foreground">
              Anyone left standing waits{' '}
              {Math.round(candidate.estimate.leftBehindWaitSeconds)}s for the bus behind.
              {candidate.estimate.leftBehindPassengers === null
                ? ' How many people that is cannot be estimated yet — passenger counts are not being measured.'
                : ` About ${Math.round(candidate.estimate.leftBehindPassengers)} passengers.`}
            </p>
          </div>
        ))}

        {paceAdvisories.map((advisory) => (
          <div key={`pace-${advisory.vehicleId}`}>
            <p className="text-sm font-medium">
              Ease <OpsIdentifier>{advisory.vehicleId}</OpsIdentifier> to{' '}
              {Math.round(advisory.targetSpeedKmph)} km/h
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{advisory.rationale}</p>
          </div>
        ))}
      </OpsStack>
    </div>
  );
}

/** Seconds, rounded, with an explicit sign so a saving reads as a saving. */
function signedSeconds(value: number): string {
  const rounded = Math.round(value);
  if (rounded === 0) return '0 s';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)} s`;
}

function PriorityBreakdown({ action }: { action: EngineCandidateAction }) {
  const cost = action.passengerCost;

  return (
    <div className="ops-well px-4 py-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
        What this costs and buys, in passenger-seconds
      </p>
      <OpsStack gap="tight">
        <OpsReadout label="Even spacing (waiting saved)" value={signedSeconds(cost.waitPassengerSeconds)} />

        <OpsReadout
          label="Punctuality (lateness added)"
          value={
            cost.scheduleUnknown
              ? 'Not weighed — no timetable loaded'
              : signedSeconds(cost.latenessPassengerSeconds)
          }
        />

        <OpsReadout
          label="Passengers aboard (delay added)"
          value={
            cost.loadEstimated
              ? 'Not weighed — no occupancy reading'
              : signedSeconds(cost.onboardPassengerSeconds)
          }
        />

        <OpsReadout label="Net" value={signedSeconds(cost.netPassengerSeconds)} />
      </OpsStack>

      {/*
        The two "not weighed" cases above are the honest state of this
        deployment and must not be silently rendered as zero. A zero cost and
        an unweighed cost look identical in a number and mean opposite things:
        the first says holding this bus is free, the second says nobody
        measured whether it is.
      */}
      {cost.scheduleUnknown || cost.loadEstimated ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Terms marked &ldquo;not weighed&rdquo; were left out of the total because the data behind
          them is not being collected yet — not because they were measured as zero.
        </p>
      ) : null}
    </div>
  );
}
