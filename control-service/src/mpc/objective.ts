// The passenger-and-operator cost a hold is ranked by.
//
// Blueprint 9.1 step 6 is "optimize_passenger_and_operator_cost", and every
// control law's `objectiveCost` doc comment has always claimed to implement
// it. Until this module existed, none of them did: `objectiveCost` was
// `|rawHold - holdSeconds|`, the residual left over by clamping and
// rounding. Candidates sort ascending on that value and the solver selects
// index 0, so the ranking was anti-correlated with need - a pair needing
// 30s scored ~0.3 and won; a pair needing 900s against a 600s cap scored
// 300 and lost. The worse the bunching, the harder the cap bit, the lower
// it ranked. With one command issued per cycle the controller reliably
// spent its single intervention on the pair that needed it least.
//
// ─── THE OBJECTIVE ───────────────────────────────────────────────────────
//
// Reference architecture section 2.2, restricted to the one control point a
// candidate acts at:
//
//   J = w_h x SUM_s [ lambda_s x h_s^2 / 2 ]   waiting cost (2nd moment)
//     + w_v x [ L x d ]                        in-vehicle delay cost
//     + w_c x [ d ]                            operator / cycle-time cost
//
// The waiting term is QUADRATIC in headway and that is the whole point
// (section 2.1). For riders arriving without consulting a timetable,
// E[wait] = E[H^2] / (2 E[H]) = (H_bar/2)(1 + CV^2): expected wait is
// governed by the SECOND moment of the headway distribution, so one 20-minute
// gap costs more than four 5-minute headways save. Ranking on |h - H*|, or
// on a threshold, or on a clamp residual, all systematically under-penalise
// large gaps - which are exactly what bunching produces.
//
// ─── WHAT A HOLD ACTUALLY MOVES ──────────────────────────────────────────
//
// Holding bus i for d seconds moves exactly two headways, in opposite
// directions: it opens the gap to the bus ahead and closes the gap to the
// bus behind by the same d.
//
//   h_fwd -> h_fwd + d        h_bwd -> h_bwd - d
//
// so the wait cost the hold is responsible for is
//
//   J_wait(d) = w_h x lambda x [ (h_fwd + d)^2 + (h_bwd - d)^2 ] / 2
//
// This is why a two-way-looking law is not an optional refinement. A
// controller that only sees h_fwd is optimising half of its own cost
// function and cannot know it is exporting the gap downstream.
//
// ─── WHY THE DELTA AND NOT THE LEVEL ─────────────────────────────────────
//
// Candidates are compared across DIFFERENT pairs, so ranking on J(d) itself
// would reproduce the original defect in a new costume: an already-healthy
// pair has a low absolute J and would win. What is comparable is how much
// cost the action REMOVES, so every candidate is scored on
//
//   netPassengerSeconds = J(d) - J(0)
//
//                       = w_h x lambda x d x (d + h_fwd - h_bwd)
//                       + w_v x L x d
//                       + w_c x d
//
// which is NEGATIVE when the hold saves more than it costs. Lower is still
// better, so the ascending sort every law and the solver already perform is
// unchanged - it now sorts by passenger benefit rather than by rounding
// error.
//
// Setting the derivative to zero gives the cost-minimising hold in closed
// form (`optimalHoldSeconds` below):
//
//   d* = (h_bwd - h_fwd) / 2  -  (w_v x L + w_c) / (2 x w_h x lambda)
//
// The first term is exactly the even-headway "split the difference" rule -
// the Tier 0 baseline deployed in Stockholm and Santiago falls out of the
// quadratic objective rather than being asserted alongside it. The second
// term is the correction the published state of the art cannot make,
// because it needs a live onboard count rather than a historical average:
// the fuller the bus, the less of the gap it is worth closing.
import type { RoutePolicyRow, VehicleStateRow } from '../state/store.js';

/**
 * Waiting-cost weight (w_h) and in-vehicle-cost weight (w_v).
 *
 * Both terms come out in PASSENGER-SECONDS - lambda x h^2 is (pax/s)(s^2)
 * and L x d is (pax)(s) - so at equal weights they are directly
 * commensurable and 1/1 is a real default rather than a placeholder. That
 * is only true while `lambda` is a real arrival rate; see
 * `arrivalRatePaxPerSecond` for the caveat that currently applies.
 *
 * Operator cost (w_c) prices a second of cycle time in passenger-seconds
 * and is 0 by default: it is a genuine third objective but there is no
 * defensible exchange rate for it in this system yet, and inventing one
 * would quietly bias every ranking. At 0 the floor on a worthwhile hold is
 * still real - the wait term alone rejects any hold that overshoots past
 * even spacing.
 *
 * Kept as named constants here for the same reason occupancyMpc.ts keeps
 * W_WAIT/W_ONBOARD: route_policies has no column for them, and a future
 * ticket promoting them to per-route-direction config should find one
 * place to change, not four.
 */
export const W_WAIT = 1;
export const W_ONBOARD = 1;
export const W_OPERATOR = 0;

/**
 * Punctuality weight (w_s): passenger-seconds charged per second of lateness
 * this hold ADDS beyond what the vehicle had already lost.
 *
 * LINEAR in lateness, not quadratic, and that is the right shape for this
 * operator rather than a simplification. The quadratic waiting term above
 * assumes riders turn up without consulting a timetable, which holds when
 * headways are short. At the measured median planned gap on this network -
 * 1,800 s - riders read the timetable and arrive AT the scheduled minute, so
 * every one of them waits exactly the lateness. Cost is then (riders per
 * departure) x lateness: linear.
 *
 * 1 is the value implied by the same 1/H* proxy `arrivalRatePaxPerSecond`
 * uses (one rider accumulates per planned headway), and it inherits that
 * proxy's calibration debt - see the caveat there.
 *
 * THE WEIGHT IS NOT THE PUNCTUALITY GUARANTEE. This term only shapes which
 * candidate is preferred. What actually stops a hold from making a bus
 * unacceptably late is the hard bound in `mpc/safety.ts`
 * (`max_lateness_breach`), which no weight can trade away. Objective
 * prefers; constraint guarantees.
 */
export const W_LATENESS = 1;

/**
 * Passenger arrival rate at the control point, pax/second.
 *
 * PROXIED as 1/H*, the same standing approximation `occupancyMpc.ts` and
 * the EWT computation in `headway/metrics.ts` already use: one passenger
 * accumulates per planned headway. It is a placeholder for the real demand
 * model (reference architecture 5.1: `lambda_s = boardings_at_s /
 * observed_headway_at_s`, per stop, per 15-minute band, per day type),
 * which needs historical APC data this service does not yet hold.
 *
 * CALIBRATION CAVEAT, and it is load-bearing: lambda sets the exchange rate
 * between waiting cost and in-vehicle cost. Under-estimating it makes the
 * onboard term dominate, and a controller that always prefers the emptier
 * bus is as wrong as one that ignores load. Today that risk is inert -
 * `occupancy_capacity` is NULL and `occupancy_count` unpopulated on every
 * seeded corridor, so `loadPassengers` resolves to null, the onboard term
 * is zero, and ranking is purely the second-moment wait cost. The onboard
 * term only starts moving decisions once someone deliberately turns
 * occupancy on - at which point lambda must be calibrated first.
 */
export function arrivalRatePaxPerSecond(targetHeadwaySeconds: number): number {
  return targetHeadwaySeconds > 0 ? 1 / targetHeadwaySeconds : 0;
}

export interface PassengerCostInputs {
  /** Forward headway of the held vehicle at the moment of the decision, seconds. */
  hFwdSeconds: number;
  /**
   * Backward headway of the held vehicle, seconds. Null when the bus behind
   * it is unobserved (back-most on a linear route-direction, or its speed
   * telemetry is missing) - see `NEUTRAL_BACKWARD_HEADWAY` handling below.
   */
  hBwdSeconds: number | null;
  targetHeadwaySeconds: number;
  /** The hold being scored, seconds, AFTER clamping and rounding. */
  holdSeconds: number;
  /** Live onboard count for the held vehicle, or null when unknown/stale. */
  loadPassengers: number | null;
  /**
   * Seconds the held vehicle is already behind its timetable (negative =
   * ahead), or null when no schedule is loaded for its trip. Null omits the
   * punctuality term entirely rather than assuming the vehicle is on time.
   */
  scheduleDeviationSeconds?: number | null;
}

export interface PassengerCost {
  /** w_h x lambda x d x (d + h_fwd - h_bwd). Negative when the hold moves both headways toward even spacing. */
  waitPassengerSeconds: number;
  /** w_v x L x d. Always >= 0 - holding never helps the people already aboard. */
  onboardPassengerSeconds: number;
  /** w_c x d. Always >= 0. */
  operatorPassengerSeconds: number;
  /**
   * w_s x the lateness this hold ADDS. Zero when the vehicle is early enough
   * to absorb the whole hold within its own slack - holding a bus that is
   * running ahead costs nothing in punctuality, which is exactly why an
   * early vehicle is the one to hold. Zero and flagged when no schedule is
   * loaded.
   */
  latenessPassengerSeconds: number;
  /** The sum, and the value candidates are ranked ascending on. Negative = the hold saves more than it costs. */
  netPassengerSeconds: number;
  /** True when `loadPassengers` was null, so the in-vehicle term is 0 rather than measured. */
  loadEstimated: boolean;
  /** True when `hBwdSeconds` was null and the neutral assumption below was used instead. */
  backwardEstimated: boolean;
  /** True when no schedule deviation was available, so no punctuality cost was priced in. */
  scheduleUnknown: boolean;
}

/**
 * Scores one candidate hold.
 *
 * When the backward headway is unavailable the bus behind is assumed to sit
 * exactly on target headway. That is the same neutral assumption
 * `selfEqualizing.ts` already makes for the same reason - it applies no
 * backward pressure in either direction, so an unobserved neighbour neither
 * manufactures a hold nor cancels one - and it keeps this function total,
 * so a candidate is never left unranked because a third vehicle was
 * missing.
 */
export function computePassengerCost(inputs: PassengerCostInputs): PassengerCost {
  const { hFwdSeconds, targetHeadwaySeconds, holdSeconds, loadPassengers } = inputs;

  const backwardEstimated = inputs.hBwdSeconds === null;
  const hBwd = inputs.hBwdSeconds ?? targetHeadwaySeconds;

  const lambda = arrivalRatePaxPerSecond(targetHeadwaySeconds);
  const waitPassengerSeconds =
    W_WAIT * lambda * holdSeconds * (holdSeconds + hFwdSeconds - hBwd);

  const loadEstimated = loadPassengers === null;
  const onboardPassengerSeconds = W_ONBOARD * (loadPassengers ?? 0) * holdSeconds;
  const operatorPassengerSeconds = W_OPERATOR * holdSeconds;

  // Only the lateness the hold ADDS is charged. A vehicle 200 s ahead of its
  // timetable held for 120 s is still 80 s ahead and has cost the timetable
  // nothing; one already 60 s late pays for every second of the hold.
  const deviation = inputs.scheduleDeviationSeconds ?? null;
  const scheduleUnknown = deviation === null;
  const latenessPassengerSeconds =
    deviation === null
      ? 0
      : W_LATENESS * (Math.max(0, deviation + holdSeconds) - Math.max(0, deviation));

  return {
    waitPassengerSeconds,
    onboardPassengerSeconds,
    operatorPassengerSeconds,
    latenessPassengerSeconds,
    netPassengerSeconds:
      waitPassengerSeconds +
      onboardPassengerSeconds +
      operatorPassengerSeconds +
      latenessPassengerSeconds,
    loadEstimated,
    backwardEstimated,
    scheduleUnknown,
  };
}

/**
 * The hold that minimises J, in closed form, before any clamping:
 *
 *   d* = (h_bwd - h_fwd)/2 - (w_v x L + w_c) / (2 x w_h x lambda)
 *
 * Not currently the source of any candidate - the deployed laws
 * (terminalDispatch / twoWayHold / selfEqualizing) generate the holds and
 * this module ranks them, which keeps the analytic shield in charge of WHAT
 * is proposed. Exported because it is the reference value a Layer 2 solver
 * would be clipped against, and because a law whose output sits far from it
 * is worth noticing.
 */
export function optimalHoldSeconds(
  inputs: Omit<PassengerCostInputs, 'holdSeconds'>,
): number {
  const hBwd = inputs.hBwdSeconds ?? inputs.targetHeadwaySeconds;
  const lambda = arrivalRatePaxPerSecond(inputs.targetHeadwaySeconds);
  const evenHeadwaySplit = (hBwd - inputs.hFwdSeconds) / 2;
  if (lambda <= 0 || W_WAIT <= 0) return Math.max(0, evenHeadwaySplit);

  const loadPenalty =
    (W_ONBOARD * (inputs.loadPassengers ?? 0) + W_OPERATOR) / (2 * W_WAIT * lambda);
  return Math.max(0, evenHeadwaySplit - loadPenalty);
}

/**
 * Live onboard count for `vehicleId`, or null when there is no usable one.
 *
 * Applies the same freshness rule `occupancyMpc.ts` applies, and for the
 * same reason: an occupancy sample older than the policy's bound is not
 * evidence about who is on the bus now. Differs in what it does about it -
 * the advisory substitutes a fixed mid-load fraction, whereas the SELECTION
 * path returns null so the in-vehicle term drops to zero. Ranking is
 * comparative, and a constant invented identically for every candidate
 * cannot break a tie; it can only shift the wait/onboard balance on the
 * strength of a number nobody measured.
 */
export function liveOnboardCount(
  vehicleState: VehicleStateRow | undefined,
  policy: RoutePolicyRow,
  now: Date,
): number | null {
  if (!vehicleState || vehicleState.occupancyCount === null) return null;
  if (policy.occupancyStaleSeconds !== null) {
    const ageSeconds = (now.getTime() - new Date(vehicleState.observedAt).getTime()) / 1000;
    if (!Number.isFinite(ageSeconds) || ageSeconds > policy.occupancyStaleSeconds) return null;
  }
  return vehicleState.occupancyCount;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * One sentence saying why this hold was recommended, in the terms the
 * decision was actually made in.
 *
 * Reference architecture Part J: "Every recommendation carries a
 * one-sentence rationale referencing the observed headways and load. Not a
 * confidence score - a reason." Deterministic given the same inputs, per
 * the same section's replay requirement, so it is safe to persist alongside
 * the command and diff in an incident review.
 */
export function explainHold(
  vehicleId: string,
  holdSeconds: number,
  inputs: PassengerCostInputs,
  cost: PassengerCost,
): string {
  const gapAhead = Math.round(inputs.hFwdSeconds);
  const target = Math.round(inputs.targetHeadwaySeconds);
  const tightBy = target - gapAhead;

  const ahead =
    tightBy > 0
      ? `${vehicleId} has closed to ${gapAhead}s behind the bus ahead, ${tightBy}s tighter than the ${target}s target`
      : `${vehicleId} sits ${gapAhead}s behind the bus ahead against a ${target}s target`;

  const behind = cost.backwardEstimated
    ? 'nothing is visible behind it, so its backward gap is assumed to be on target'
    : `the bus behind is ${Math.round(inputs.hBwdSeconds!)}s back`;

  const load = cost.loadEstimated
    ? 'no onboard count is available, so no in-vehicle delay was priced in'
    : `${inputs.loadPassengers} passengers aboard were charged ${round(cost.onboardPassengerSeconds)} passenger-seconds of delay`;

  const deviation = inputs.scheduleDeviationSeconds ?? null;
  const punctuality = cost.scheduleUnknown
    ? 'no timetable is loaded for this trip, so its punctuality was not weighed'
    : deviation! > 0
      ? `it is already ${Math.round(deviation!)}s behind schedule and the hold adds ${round(cost.latenessPassengerSeconds)}s more`
      : cost.latenessPassengerSeconds > 0
        ? `it is ${Math.round(-deviation!)}s ahead of schedule, and the hold spends that slack plus ${round(cost.latenessPassengerSeconds)}s`
        : `it is ${Math.round(-deviation!)}s ahead of schedule, so the hold costs the timetable nothing`;

  const verdict =
    cost.netPassengerSeconds < 0
      ? `a net saving of ${round(-cost.netPassengerSeconds)} passenger-seconds`
      : `a net cost of ${round(cost.netPassengerSeconds)} passenger-seconds`;

  return `Hold ${holdSeconds}s: ${ahead} and ${behind}, so evening the two gaps is worth ${verdict}; ${punctuality}; ${load}.`;
}

/** The scoring fields every control law attaches to the candidate it generates. */
export interface HoldScore {
  objectiveCost: number;
  clampResidualSeconds: number;
  passengerCost: PassengerCost;
  rationale: string;
  scheduleDeviationSeconds: number | null;
}

/**
 * Scores one law's proposed hold once, so terminalDispatch / twoWayHold /
 * selfEqualizing cannot drift into ranking their candidates on three
 * subtly different numbers. The solver compares them against each other
 * directly, so they must be the same number computed the same way.
 */
export function scoreHold(
  headwayState: {
    hFwdSeconds: number | null;
    hBwdSeconds: number | null;
    targetHeadwaySeconds: number;
  },
  vehicleId: string,
  holdSeconds: number,
  rawHoldSeconds: number,
  loadPassengers: number | null,
  scheduleDeviationSeconds: number | null = null,
): HoldScore {
  const inputs: PassengerCostInputs = {
    hFwdSeconds: headwayState.hFwdSeconds ?? headwayState.targetHeadwaySeconds,
    hBwdSeconds: headwayState.hBwdSeconds,
    targetHeadwaySeconds: headwayState.targetHeadwaySeconds,
    holdSeconds,
    loadPassengers,
    scheduleDeviationSeconds,
  };
  const passengerCost = computePassengerCost(inputs);
  return {
    objectiveCost: passengerCost.netPassengerSeconds,
    clampResidualSeconds: Math.abs(rawHoldSeconds - holdSeconds),
    passengerCost,
    rationale: explainHold(vehicleId, holdSeconds, inputs, passengerCost),
    scheduleDeviationSeconds,
  };
}
