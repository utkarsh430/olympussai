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
import { isPairActionable, occupancyAdjustedMaxHoldSeconds } from './actionThreshold.js';
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
  /**
   * Stops each vehicle still has to serve, for the objective's waiting
   * horizon. Empty - the default - leaves every candidate on the one-stop
   * term, which is the deployed behaviour; `mpc/solver.ts` populates it only
   * when `MULTI_STOP_WAIT_TERM_ENABLED` is on, so every candidate in one
   * solve is priced under the same rule. See mpc/objective.ts.
   */
  downstreamStopsByVehicleId: ReadonlyMap<string, number | null> = new Map(),
  /**
   * Whether the forecast-admission gate may widen this law's action bar for a
   * pair predicted to deteriorate toward it. Defaults FALSE - today's
   * behaviour and the deployed default - so a direct caller keeps the
   * ungated law; `mpc/solver.ts` passes the real setting
   * (`FORECAST_ACTION_GATE_ENABLED`). See mpc/actionThreshold.ts.
   */
  forecastGateEnabled = false,
): CandidateAction[] {
  const candidates: CandidateAction[] = [];

  for (const h of headwayStates) {
    if (terminalVehicleIds.has(h.followerVehicleId)) continue;
    // Both gaps are required. With no h_bwd the closed form degenerates to
    // half the forward shortfall, which is not "the optimum given what we
    // know" - it is a different, worse controller wearing the optimum's name.
    // The pair belongs to selfEqualizing.ts in that case.
    if (h.hFwdSeconds === null || h.hBwdSeconds === null) continue;
    // Not deviant enough to be worth an instruction, and not forecast to
    // become so - see mpc/actionThreshold.ts. With the gate off this is
    // exactly `isWorthActingOn` and the forecast is not read.
    if (!isPairActionable(h, policy, forecastGateEnabled)) continue;
    if (!canExecuteHold(vehicleStatesByVehicleId.get(h.followerVehicleId), controlPointStopIds)) continue;

    const load = liveOnboardCount(vehicleStatesByVehicleId.get(h.followerVehicleId), policy, now, weighOccupancy);
    const deviationSeconds = scheduleDeviationByVehicleId.get(h.followerVehicleId) ?? null;

    // ─── THE LOAD IS BOUND ON THE ACTION, NOT ON THE CLOSED FORM ─────────
    //
    // `loadPassengers: null` here is deliberate and it is the whole fix for
    // the silence described below. `optimalHoldSeconds` is a faithful argmin
    // and stays one - it is the right answer the day lambda is measured - but
    // the penalty it subtracts is
    //
    //     (w_v x L + w_c) / (2 x w_h x lambda)
    //
    // and `arrivalRatePaxPerSecond` proxies lambda as 1/H*, so that is
    // L x H*/2 SECONDS PER PASSENGER: 180 s each on the urban corridor's 360 s
    // headway, ~39,600 s on the inter-city preset. d* is floored at 0, so a
    // bus carrying two people asked for no hold at all and this law returned
    // here on every pair - three fleet trials reported `lawCoverage` of
    // exactly 0 for `cost_optimal` in the occupancy-weighed phase against
    // 310-578 in the blind phase of the same trial. Feeding an uncalibrated
    // term into the argmin does not price the load, it deletes the law.
    //
    // `actionThreshold.ts#occupancyAdjustedMaxHoldSeconds` is where the load
    // binds instead, exactly as that module already argues it must ("the load
    // has to bind on the ACTION, not on the ordering") and exactly as the
    // other four laws already do it. The taper can shorten a hold and can
    // never invert one, so it cannot silence the controller the way an
    // uncalibrated argmin can. It is applied below, on `load`.
    //
    // The SCORE still weighs `load` - see `scoreHold` below. That is not an
    // oversight and must not be "tidied up": every law prices its candidate
    // through the same `computePassengerCost`, and dropping the term here
    // alone would hand this law a systematically lower cost than the four it
    // is sorted against, which is the sort it must not win until lambda is
    // measured. See COST_OPTIMAL_SELECTION_ENABLED in config/env.ts.
    // The horizon the objective's waiting term is summed over. It divides the
    // argmin's load penalty, so it belongs here as much as in the score - but
    // the penalty is already zero with `loadPassengers: null` and W_OPERATOR
    // at 0, so today this changes d* by nothing at all. Passed anyway,
    // because the two must not be able to disagree about which objective this
    // law is the minimiser of: the day either of those changes, an argmin
    // computed against a one-stop objective and scored against a multi-stop
    // one would be minimising a function nothing evaluates.
    const downstreamStopCount = downstreamStopsByVehicleId.get(h.followerVehicleId) ?? null;
    const rawHold = optimalHoldSeconds({
      hFwdSeconds: h.hFwdSeconds,
      hBwdSeconds: h.hBwdSeconds,
      targetHeadwaySeconds: h.targetHeadwaySeconds,
      loadPassengers: null,
      scheduleDeviationSeconds: deviationSeconds,
      downstreamStopCount,
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

    const score = scoreHold(
      h,
      h.followerVehicleId,
      holdSeconds,
      rawHold,
      load,
      deviationSeconds,
      downstreamStopCount,
    );

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
