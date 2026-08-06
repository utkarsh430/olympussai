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

    const candidateIsStale = ageSeconds(candidate.stateAsOf, context.now) > context.staleAfterSeconds;
    const anyInvolvedVehicleStale = candidate.involvedVehicleIds.some(
      (vehicleId) =>
        ageSeconds(context.vehicleObservedAtByVehicleId.get(vehicleId), context.now) > context.staleAfterSeconds,
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
