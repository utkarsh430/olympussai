// Algorithm D - the hold the objective itself asks for.
//
// ─── WHY THIS EXISTS ─────────────────────────────────────────────────────
//
// `objective.ts` has carried a closed-form optimum since the passenger-cost
// work landed:
//
//   d* = (h_bwd - h_fwd)/2 - (w_v x L + w_c) / (2 x w_h x lambda)
//
// It is the minimiser of the cost this system says it is minimising - the
// even-headway split, corrected for the passengers already on the bus and for
// the operator's cost of standing still. And nothing called it. Every
// candidate the solver ever ranked came from a proportional control law
// (Kf/Kb gains, or the self-equalising fallback), and the objective was used
// only to SCORE what those laws happened to propose. The optimum was
// reachable only by coincidence.
//
// That gap matters for exactly the reason the operator's three priorities
// state it. A gains-based law knows about the gap in front and the gap behind.
// It does not know how many people are on the bus being held, and it cannot
// know what their time is worth against the time of the people waiting at the
// next stop. The closed form is where those enter, and it is the only
// candidate here that is derived from the priorities rather than tuned to
// approximate them.
//
// ─── WHY IT DOES NOT REPLACE THE OTHER LAWS ──────────────────────────────
//
// It is added as a fourth candidate, not as a replacement, and it competes on
// the same ranking as the rest.
//
//   * The gains are POLICY. Kf/Kb are how an operator expresses how
//     aggressively a corridor should be regulated, they are tuned per
//     corridor against local experience, and deleting the laws that read them
//     would silently discard that.
//   * The closed form needs h_bwd. Where the bus behind is unknown - a
//     single-vehicle stretch, a stale trailer reading - it has nothing to say,
//     and `selfEqualizing.ts` remains the designated fallback.
//   * lambda is a PROXY today (1/H*, see `arrivalRatePaxPerSecond`), and the
//     load term is inert until something writes occupancy. Until both are
//     measured, this law's advantage over a well-tuned gain is theoretical,
//     and asserting otherwise by making it the only candidate would be
//     claiming a calibration this deployment does not have.
//
// Competing rather than replacing also makes the comparison observable: when
// the closed form and the tuned gains disagree, both appear in
// `candidateActions` on the recommendation, and the disagreement is a fact
// about the corridor's tuning that someone can look at.
import { clamp } from './math.js';
import { canExecuteHold } from './eligibility.js';
import { liveOnboardCount, optimalHoldSeconds, scoreHold } from './objective.js';
import { isWorthActingOn, occupancyAdjustedMaxHoldSeconds } from './actionThreshold.js';
import type { CandidateAction } from './types.js';
import type { HeadwayStateRow, RoutePolicyRow, VehicleStateRow } from '../state/store.js';

/**
 * Holds shorter than this are not worth an instruction.
 *
 * A driver asked to wait four seconds will not measure it, and the request
 * spends the one thing this system cannot buy back - the driver's willingness
 * to take the next instruction seriously. `safety.ts` enforces a policy-level
 * `minimum_action_seconds` for the same reason; this is the law declining to
 * generate the candidate at all, so a corridor that has set no policy minimum
 * still never emits one.
 */
export const MIN_MEANINGFUL_HOLD_SECONDS = 15;

/**
 * The cost-minimising hold for every pair that can take one.
 *
 * Deliberately mirrors `computeTwoWayCandidates`' signature and guards - the
 * terminal exclusion, the eligibility gate, the clamp to `maxHoldSeconds` and
 * the ascending sort - so that the two are comparable candidate-for-candidate
 * and neither can quietly acquire a different notion of which buses are
 * holdable.
 */
export function computeCostOptimalCandidates(
  headwayStates: HeadwayStateRow[],
  terminalVehicleIds: ReadonlySet<string>,
  policy: RoutePolicyRow,
  vehicleStatesByVehicleId: ReadonlyMap<string, VehicleStateRow> = new Map(),
  now: Date = new Date(),
  scheduleDeviationByVehicleId: ReadonlyMap<string, number | null> = new Map(),
  controlPointStopIds: ReadonlySet<string> = new Set(),
  /**
   * Whether the network-wide occupancy switch is on
   * (`control_settings.weigh_occupancy`). Defaults true so a direct caller -
   * a test, a rehearsal - keeps the unswitched behaviour; the solver always
   * passes the real setting. See mpc/objective.ts#liveOnboardCount.
   */
  weighOccupancy = true,
): CandidateAction[] {
  const candidates: CandidateAction[] = [];

  for (const h of headwayStates) {
    if (terminalVehicleIds.has(h.followerVehicleId)) continue;
    // Both gaps are required. With no h_bwd the closed form degenerates to
    // half the forward shortfall, which is not "the optimum given what we
    // know" - it is a different, worse controller wearing the optimum's name.
    // The pair belongs to selfEqualizing.ts in that case.
    if (h.hFwdSeconds === null || h.hBwdSeconds === null) continue;
    // Not deviant enough to be worth an instruction - see mpc/actionThreshold.ts.
    if (!isWorthActingOn(h.hFwdSeconds, policy)) continue;
    if (!canExecuteHold(vehicleStatesByVehicleId.get(h.followerVehicleId), controlPointStopIds)) continue;

    const load = liveOnboardCount(vehicleStatesByVehicleId.get(h.followerVehicleId), policy, now, weighOccupancy);
    const deviationSeconds = scheduleDeviationByVehicleId.get(h.followerVehicleId) ?? null;

    const rawHold = optimalHoldSeconds({
      hFwdSeconds: h.hFwdSeconds,
      hBwdSeconds: h.hBwdSeconds,
      targetHeadwaySeconds: h.targetHeadwaySeconds,
      loadPassengers: load,
      scheduleDeviationSeconds: deviationSeconds,
    });
    if (rawHold <= 0) continue;

    const holdSeconds = Math.round(
      clamp(
        rawHold,
        0,
        occupancyAdjustedMaxHoldSeconds(policy.maxHoldSeconds, load, policy.occupancyCapacity),
      ),
    );
    if (holdSeconds < MIN_MEANINGFUL_HOLD_SECONDS) continue;

    const score = scoreHold(h, h.followerVehicleId, holdSeconds, rawHold, load, deviationSeconds);

    // The optimum of a cost function should not increase that cost. When it
    // does, the reason is always that the hold was clamped away from d* - by
    // `maxHoldSeconds`, or by the rounding above - and a clamped optimum is
    // just another feasible point with no claim on being best. Emitting it
    // would put a candidate the objective scores as HARMFUL onto a list sorted
    // by that same objective, where it can only ever sort last and confuse a
    // reader. Dropping it also means this law can never make the selection
    // worse than not having run at all.
    if (score.objectiveCost >= 0) continue;

    candidates.push({
      actionType: 'cost_optimal_hold',
      vehicleId: h.followerVehicleId,
      involvedVehicleIds: [h.followerVehicleId, h.leaderVehicleId],
      holdSeconds,
      ...score,
      routeDirectionId: h.routeDirectionId,
      stateAsOf: h.computedAt,
      headwayDeviationSeconds: h.hFwdSeconds - h.targetHeadwaySeconds,
      targetHeadwaySeconds: h.targetHeadwaySeconds,
    });
  }

  return candidates.sort((a, b) => a.objectiveCost - b.objectiveCost);
}
