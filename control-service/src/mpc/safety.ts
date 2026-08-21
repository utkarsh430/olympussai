// Hard safety filter (blueprint 9.1 step 5 "safety & feasibility filter":
// "max hold and safe-speed bounds", "no stale commands"; Appendix B
// pseudocode `safe_candidates = apply_hard_constraints(candidates, quality,
// route_policy)`). Runs after candidate generation and before selection -
// a candidate that fails ANY check here is never eligible to be selected,
// regardless of how good its objective cost looks.
import { wouldBreachLateness } from '../schedule/deviation.js';
import { isHoldAction } from './types.js';
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
  /**
   * `route_policies.max_lateness_seconds`: the furthest behind its timetable
   * a vehicle may be left by a hold this filter approves.
   *
   * Null disables the check, and it is null on every corridor today because
   * no timetable is loaded to measure lateness against. That is a deliberate
   * no-op rather than a fail-open hole: a candidate's
   * `scheduleDeviationSeconds` is null in exactly the same circumstances, so
   * there is nothing to compare, and inventing a deviation in order to have
   * something to reject would make this guardrail vouch for a bound it never
   * measured. `maxHoldSeconds` still bounds every candidate unconditionally.
   */
  maxLatenessSeconds: number | null;
  /**
   * `route_policies.cooldown_seconds`, and the set of vehicles that received
   * an instruction inside that window.
   *
   * The column has existed since the core data model and was never enforced -
   * it was loaded into the store, reported on the solve result's
   * `constraints`, and checked by nothing. With the decision cycle now asking
   * the controller for an answer every 90 seconds, an unenforced cooldown
   * means the same driver can be issued a fresh hold on every sweep.
   */
  recentlyCommandedVehicleIds: ReadonlySet<string>;
  /**
   * `route_policies.minimum_action_seconds`: the shortest hold worth giving.
   *
   * Also never enforced before. A hold shorter than this is not a small
   * benefit, it is a net cost - it spends the driver's attention and the
   * dispatcher's, and it teaches both that the instructions are noise.
   */
  minimumActionSeconds: number;
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

    // ─── THE HOLD-LENGTH CHECKS ONLY APPLY TO HOLDS ──────────────────────
    //
    // `boarding_limit` (mpc/boardingLimit.ts) asks a driver to spend LESS
    // time at a stop, so its holdSeconds is 0. Run through the checks below
    // unguarded, a corridor with `minimum_action_seconds` set would reject
    // every alighting-only proposal as "below minimum action" - refusing the
    // one lever that costs no delay at all, for being zero seconds long.
    //
    // The staleness, conflicting-command and cooldown checks above and below
    // DO apply to it: those are about whether the vehicle can be given an
    // instruction at all, which is a question about the bus, not the action.
    const isHold = isHoldAction(candidate.actionType);

    if (
      isHold &&
      (!Number.isFinite(candidate.holdSeconds) ||
        candidate.holdSeconds < 0 ||
        candidate.holdSeconds > context.maxHoldSeconds)
    ) {
      reasons.push('max_hold_cap_breach');
    }

    if (context.activeCommandVehicleIds.has(candidate.vehicleId)) {
      reasons.push('conflicting_active_command');
    }

    // Punctuality guardrail. Spacing is bought with delay, and this is the
    // point at which the price becomes too high: the hold is otherwise
    // sound, but the vehicle would end up further behind its timetable than
    // the corridor permits. Rejecting here rather than shrinking the hold is
    // deliberate - a silently shortened hold would be attributed to the
    // control law, and the operator would never learn that punctuality, not
    // the headway maths, decided this.
    // Instruction-quality guardrails. Both are about whether this hold is
    // worth GIVING, as distinct from whether it is safe to give.
    if (context.recentlyCommandedVehicleIds.has(candidate.vehicleId)) {
      reasons.push('cooldown_active');
    }

    if (isHold && candidate.holdSeconds < context.minimumActionSeconds) {
      reasons.push('below_minimum_action');
    }

    // Only a hold can push a bus further behind its timetable. Alighting-only
    // moves the lateness the other way, so asking whether it "would breach"
    // a lateness bound is not a check that has been relaxed for it - it is a
    // question that does not apply.
    if (
      isHold &&
      wouldBreachLateness(
        candidate.scheduleDeviationSeconds,
        candidate.holdSeconds,
        context.maxLatenessSeconds,
      )
    ) {
      reasons.push('max_lateness_breach');
    }

    if (reasons.length > 0) {
      rejected.push({ candidate, reasons });
    } else {
      safe.push(candidate);
    }
  }

  return { safe, rejected };
}
