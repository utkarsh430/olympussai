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

// ─── ONE STOP, OR THE STOPS THAT ARE LEFT ────────────────────────────────
//
// Note what section 2.2's waiting term actually says: `SUM_s`, over stops.
// The expression above evaluates it at ONE stop, the control point the hold
// is issued from, and that restriction is stated at the top of this file. It
// is also the single largest error in this module, and it is measured.
//
// A hold does not move a headway at one stop. It moves the pair's two
// headways for the REST OF THE TRIP: the held bus arrives d later at every
// stop it has yet to serve, so `h_fwd + d` and `h_bwd - d` are what the
// passengers at all of those stops experience, not just the ones at this
// one. Summing the same expression over the N stops the vehicle still has to
// serve gives
//
//   netWait = w_h x lambda x d x (d + h_fwd - h_bwd) x N
//
// with the perturbation carried forward UNCHANGED between stops. That is a
// neutral assumption of exactly the kind this module already makes for an
// unobserved backward neighbour, and it is neutral in a specific sense: the
// fitted dwell model says a headway deviation GROWS by `1 + beta_h` per stop
// (`calibration/dwell.ts#headwayAmplification`), while re-regulation
// downstream shrinks it, and the measurement below says the two roughly
// cancel over the horizons these corridors have.
//
// MEASURED, and this is the check the form has to pass. HANDOFF.md section 7
// grades the objective's wait term against the waiting a hold really removes,
// on all three corridors, with a correctly fitted lambda: it is short by
// 10.0x on urban, 5.4x on suburban and 2.5x on inter-city, against mean stops
// downstream of a hold of ~12.5, ~7.5 and ~5. Divide one by the other and the
// residual is 0.80, 0.72 and 0.50 - i.e. the missing factor IS the horizon.
//
// It is O(1) and it is not a constant. Re-measured as a per-hold marginal
// (suppress one hold in an otherwise identical run under common random numbers
// and diff the engine's own waiting figure) the same residual comes out
// 0.58 / 0.51 / 0.88 on the ten-scenario set and 1.71 / 0.52 / 2.14 on the
// nineteen-scenario one: three measurements, three orderings across the same
// three corridors. A decay coefficient is exactly a claim about that ordering.
// And the mechanism one would need is absent - a hold's correction survives
// ~1.0 of itself at +1 stop everywhere, decays on urban and suburban, and on
// inter-city AMPLIFIES past +3 while that corridor benefits least of the
// three. So N carries no decay coefficient: the term is the sum the
// architecture already specifies, over the stops that are left. Fitting one to
// three points that swap rank is the error `mpc/actionThreshold.ts` records
// rejecting. Full tables in docs/MULTI_STOP_WAIT_TERM.md.
//
// N is `downstreamStopCount` below. It is null wherever the corridor's stop
// sequence is not loaded, and null means 1 - today's one-stop term exactly -
// so this is a strict generalisation and the deployed default is unchanged.
// See `MULTI_STOP_WAIT_TERM_ENABLED` in config/env.ts for the switch that
// decides whether a count is supplied at all, and for what is still missing
// after it (lambda: the horizon is worth 5-13x, the 1/H* proxy a further
// 7-11x, and the two multiply).
//
// Setting the derivative to zero gives the cost-minimising hold in closed
// form (`optimalHoldSeconds` below):
//
//   d* = (h_bwd - h_fwd) / 2  -  (w_v x L + w_c) / (2 x w_h x lambda x N)
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
  /**
   * How many stops the held vehicle still has to serve, COUNTING the one it
   * is standing at - the N the waiting term is summed over. See this file's
   * header for the derivation and for the measurement it is checked against.
   *
   * Null / absent means the horizon is not known here, and is priced as 1:
   * exactly today's one-stop term. Every caller that cannot answer the
   * question therefore keeps the deployed behaviour rather than guessing a
   * horizon, and the multi-stop term ships off by supplying nothing (see
   * `MULTI_STOP_WAIT_TERM_ENABLED`).
   */
  downstreamStopCount?: number | null;
}

export interface PassengerCost {
  /** w_h x lambda x d x (d + h_fwd - h_bwd) x N. Negative when the hold moves both headways toward even spacing. */
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
  /**
   * The N the wait term was summed over: stops the vehicle still has to
   * serve, or 1 when no horizon was supplied.
   *
   * Reported rather than inferred because `explainHold` states it to a
   * dispatcher and a surface must not be able to claim a horizon the
   * arithmetic did not use.
   *
   * OPTIONAL for one reason only, and it is not "to spare an implementer":
   * `mpc/boardingLimit.ts` publishes an all-zero `PassengerCost` as a
   * documented sentinel meaning "neither side of this trade is priced". A
   * horizon of 1 there would be a claim about a wait term that was never
   * computed. Absent therefore means exactly that - no waiting was priced -
   * and `computePassengerCost` always sets it.
   */
  waitHorizonStops?: number;
  /** True when no schedule deviation was available, so no punctuality cost was priced in. */
  scheduleUnknown: boolean;
}

/**
 * The N the waiting term is summed over, normalised.
 *
 * NEVER less than 1, and that floor is load-bearing rather than defensive: 0
 * would multiply the whole benefit side away and leave a hold priced as pure
 * in-vehicle cost, which is a strictly worse objective than the one-stop term
 * this generalises. A vehicle standing at its LAST stop still has one stop's
 * worth of waiting to move - the one it is at - so 1 is also the physically
 * right floor, not merely a safe one.
 *
 * Whole stops. A fractional horizon would be a claim about how far a
 * correction survives, and this module deliberately makes no such claim -
 * see the file header for the two measurements that disagree about it.
 *
 * Not gated on `MULTI_STOP_WAIT_TERM_ENABLED` here. The switch decides
 * whether a caller SUPPLIES a count at all (`mpc/solver.ts` and
 * `rehearsal/deployedControlLaws.ts` each read it once per solve, so every
 * candidate in one solve is priced under the same rule); this function is
 * total over whatever it is handed, which is what keeps it testable and keeps
 * the hot path free of an env read per candidate.
 */
export function waitHorizonStops(downstreamStopCount: number | null | undefined): number {
  if (downstreamStopCount === null || downstreamStopCount === undefined) return 1;
  if (!Number.isFinite(downstreamStopCount)) return 1;
  return Math.max(1, Math.floor(downstreamStopCount));
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
  const horizonStops = waitHorizonStops(inputs.downstreamStopCount);
  const waitPassengerSeconds =
    W_WAIT * lambda * holdSeconds * (holdSeconds + hFwdSeconds - hBwd) * horizonStops;

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
    waitHorizonStops: horizonStops,
    scheduleUnknown,
  };
}

/**
 * The hold that minimises J, in closed form, before any clamping:
 *
 *   d* = (h_bwd - h_fwd)/2 - (w_v x L + w_c) / (2 x w_h x lambda x N)
 *
 * N is the horizon the waiting term is summed over (`downstreamStopCount`,
 * 1 when unknown). It divides the load penalty because it multiplies the term
 * that penalty is traded against, and that is the whole of its effect here:
 * the even-headway split has no lambda in it and does not move. This is the
 * same argmin it has always been, of the objective this module actually
 * scores - see the file header.
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

  const horizonStops = waitHorizonStops(inputs.downstreamStopCount);
  const loadPenalty =
    (W_ONBOARD * (inputs.loadPassengers ?? 0) + W_OPERATOR) /
    (2 * W_WAIT * lambda * horizonStops);
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
  weighOccupancy = true,
): number | null {
  // ─── THE NETWORK-WIDE OCCUPANCY SWITCH ─────────────────────────────────
  //
  // Gated HERE rather than by zeroing W_ONBOARD, because this function is
  // already the single place that answers "is there a load worth weighing?",
  // and null already means "do not weigh one". Every consumer - the four
  // control laws and `optimalHoldSeconds` - reads load through this, so one
  // check covers all of them and none of them needs to learn about the
  // switch.
  //
  // Zeroing the weight instead would have meant a mutable module constant
  // shared by every corridor and every in-flight solve, which is the kind of
  // global that goes wrong once under concurrency and is never reproduced.
  //
  // With the switch OFF the objective reduces to exactly the two terms the
  // operator named as priorities: the wait cost that even spacing minimises,
  // and the lateness cost that punctuality minimises. See
  // db/migrations/20260820130000__control_settings.sql for why OFF is the
  // right default until lambda is calibrated.
  if (!weighOccupancy) return null;

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

  // Said only when it is more than one, so the sentence a dispatcher reads on
  // every corridor today is unchanged, and so "over N stops" never appears
  // when the arithmetic was done at a single stop.
  const horizonStops = cost.waitHorizonStops ?? 1;
  const horizon = horizonStops > 1 ? ` over the ${horizonStops} stops it has left` : '';

  return `Hold ${holdSeconds}s: ${ahead} and ${behind}, so evening the two gaps${horizon} is worth ${verdict}; ${punctuality}; ${load}.`;
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
  /**
   * Stops the held vehicle still has to serve, for the waiting term's
   * horizon. Null - the default - is the one-stop term every deployment
   * scores on today. See `PassengerCostInputs.downstreamStopCount`.
   */
  downstreamStopCount: number | null = null,
): HoldScore {
  const inputs: PassengerCostInputs = {
    hFwdSeconds: headwayState.hFwdSeconds ?? headwayState.targetHeadwaySeconds,
    hBwdSeconds: headwayState.hBwdSeconds,
    targetHeadwaySeconds: headwayState.targetHeadwaySeconds,
    holdSeconds,
    loadPassengers,
    scheduleDeviationSeconds,
    downstreamStopCount,
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
