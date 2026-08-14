// Hard safety filter (blueprint 9.1 step 5 "safety & feasibility filter":
// "max hold and safe-speed bounds", "no stale commands"; Appendix B
// pseudocode `safe_candidates = apply_hard_constraints(candidates, quality,
// route_policy)`). Runs after candidate generation and before selection -
// a candidate that fails ANY check here is never eligible to be selected,
// regardless of how good its objective cost looks.
import type { CandidateAction, SafetyRejection, SafetyRejectionReason } from './types.js';

/**
 * Default freshness bound for the state a candidate was computed from
 * (blueprint 9.1 step 1 "validate freshness"). There is no dedicated
 * route_policies column for this yet (unlike occupancy_stale_seconds) -
 * 90s is a conservative multiple of the typical 10-30s AVL ping interval.
 * Documented as a named constant rather than a magic number so a future
 * ticket can promote it to a per-route-direction policy column without
 * hunting for it.
 */
export const DEFAULT_STATE_STALE_SECONDS = 90;

/**
 * How far AHEAD of now a reading may be stamped before it is unusable.
 *
 * The staleness test below is one-sided by nature — `age > staleAfterSeconds`
 * — so a reading from the future has a negative age and can never trip it. A
 * `vehicle_states` row observed on the live control database carried
 * `observed_at = 2046-03-27`, roughly 19.6 years ahead: under the one-sided
 * test that vehicle is permanently, unconditionally "fresh", and the filter
 * would vouch for a hold computed from a reading whose true age nobody knows.
 *
 * ingestion/upsrtc/normalize.ts already refuses to WRITE such a row (see
 * `parseUpstreamInstant`, and tests/seed/upstreamInstant.ts's "yields a
 * positive age so the MPC staleness filter can actually fire"), but that
 * guard only covers rows arriving through the poller from the day it landed.
 * It does nothing for a row already in the table, and this filter is the
 * blueprint's non-negotiable guardrail — it must not depend on an upstream
 * guard having been correct.
 *
 * The tolerance matches that module's own FUTURE_SKEW_TOLERANCE_MS: a couple
 * of minutes is unit clock drift plus ours, and anything past it is not skew,
 * it is wrong.
 */
export const FUTURE_STATE_TOLERANCE_SECONDS = 120;

export interface SafetyFilterContext {
  now: Date;
  staleAfterSeconds: number;
  maxHoldSeconds: number;
  /** vehicleId -> ISO observedAt for every vehicle referenced by any candidate's `involvedVehicleIds`. A vehicle with no entry is treated as stale (no state at all beats acting on an assumption). */
  vehicleObservedAtByVehicleId: ReadonlyMap<string, string>;
  /** vehicleIds that currently have an active (non-terminal-status) command outstanding - see `commands_active_idx` / `listActiveVehicleIds`. Issuing a second hold on top of one already in flight is exactly the "conflicting active command" this filter exists to reject. */
  activeCommandVehicleIds: ReadonlySet<string>;
}

function ageSeconds(iso: string | undefined, now: Date): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const age = (now.getTime() - new Date(iso).getTime()) / 1000;
  return Number.isFinite(age) ? age : Number.POSITIVE_INFINITY;
}

/**
 * Whether a reading may be reasoned over at all.
 *
 * TWO-SIDED on purpose. Too old is the obvious failure; stamped meaningfully
 * in the FUTURE is the one that hides, because it makes the age negative and
 * the "too old" comparison silently unfalsifiable. Both answers are the same:
 * the reading's true age is unknown, so the controller does not vouch for a
 * hold computed from it. See FUTURE_STATE_TOLERANCE_SECONDS.
 */
function isUnusableReading(iso: string | undefined, now: Date, staleAfterSeconds: number): boolean {
  const age = ageSeconds(iso, now);
  return age > staleAfterSeconds || age < -FUTURE_STATE_TOLERANCE_SECONDS;
}

/**
 * Splits `candidates` into ones that are safe to select and ones that are
 * hard-rejected, each with the reason(s) it failed - kept on the rejected
 * record (rather than just dropped) so the recommendation payload stays
 * explainable (blueprint 9.1 step 6 "explain(selected, evidence, expected
 * recovery, guardrails)") and auditable.
 */
export function applyHardSafetyFilter(
  candidates: CandidateAction[],
  context: SafetyFilterContext,
): { safe: CandidateAction[]; rejected: SafetyRejection[] } {
  const safe: CandidateAction[] = [];
  const rejected: SafetyRejection[] = [];

  for (const candidate of candidates) {
    const reasons: SafetyRejectionReason[] = [];

    const candidateIsStale = isUnusableReading(
      candidate.stateAsOf,
      context.now,
      context.staleAfterSeconds,
    );
    const anyInvolvedVehicleStale = candidate.involvedVehicleIds.some((vehicleId) =>
      isUnusableReading(
        context.vehicleObservedAtByVehicleId.get(vehicleId),
        context.now,
        context.staleAfterSeconds,
      ),
    );
    if (candidateIsStale || anyInvolvedVehicleStale) {
      reasons.push('stale_state');
    }

    if (!Number.isFinite(candidate.holdSeconds) || candidate.holdSeconds < 0 || candidate.holdSeconds > context.maxHoldSeconds) {
      reasons.push('max_hold_cap_breach');
    }

    if (context.activeCommandVehicleIds.has(candidate.vehicleId)) {
      reasons.push('conflicting_active_command');
    }

    if (reasons.length > 0) {
      rejected.push({ candidate, reasons });
    } else {
      safe.push(candidate);
    }
  }

  return { safe, rejected };
}
