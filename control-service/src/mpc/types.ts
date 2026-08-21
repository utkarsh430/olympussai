// Shared types for the decision engine (blueprint section 8: terminal
// dispatch regulation, two-way holding, self-equalizing fallback,
// occupancy-weighted MPC advisory) plus the hard safety filter (blueprint
// 9.1 step 5 "safety & feasibility filter"). Split out from solver.ts so
// each control-law module (terminalDispatch.ts, twoWayHold.ts,
// selfEqualizing.ts, safety.ts, occupancyMpc.ts) can import the shape
// without a circular import back through solver.ts.
import type { PassengerCost } from './objective.js';

/** One committable candidate action, per Appendix A / blueprint 8.2-8.4. */
export interface CandidateAction {
  actionType:
    | 'terminal_dispatch_hold'
    | 'two_way_hold'
    | 'self_equalizing_hold'
    /** The closed-form minimiser of the passenger-cost objective - see mpc/costOptimalHold.ts. */
    | 'cost_optimal_hold'
    /**
     * Alighting-only: let people off, take nobody on, because the bus behind
     * is right there (mpc/boardingLimit.ts).
     *
     * The ONE action here that is not a hold, and the only one that improves
     * spacing by removing delay rather than adding it. `holdSeconds` is 0 on
     * these, which is a real length and not a missing one - `isHoldAction`
     * below is what keeps the hold-length checks in safety.ts from reading it
     * as an empty instruction.
     */
    | 'boarding_limit';
  /** The vehicle a hold command would be issued to. */
  vehicleId: string;
  /**
   * Every vehicle whose live state the computation depended on (the held
   * vehicle plus its leader/follower). The hard safety filter rejects the
   * whole candidate if ANY of these is stale - a fresh follower reading
   * paired with a stale leader reading is still unsafe to act on.
   */
  involvedVehicleIds: string[];
  holdSeconds: number;
  /**
   * The candidate's net passenger-and-operator cost in PASSENGER-SECONDS:
   * how much cost applying this hold removes (negative) or adds (positive)
   * versus doing nothing, under the quadratic-in-headway objective in
   * `objective.ts`. This is blueprint 9.1 step 6
   * "optimize_passenger_and_operator_cost", and candidates are ranked
   * ascending on it so the most beneficial hold sorts first.
   *
   * NOT a hold length, and no longer the clamp residual it used to be -
   * that value ranked candidates by how hard the cap had bitten, which put
   * the most bunched pair last. It is still carried, as
   * `clampResidualSeconds`, because "the cap is what shaped this hold" is
   * genuinely worth showing a dispatcher; it just must not decide anything.
   */
  objectiveCost: number;
  /**
   * |rawHold - holdSeconds| in seconds: 0 when the applied hold is exactly
   * what the law's formula asked for, positive when `max_hold_seconds` or
   * rounding pulled it away. Diagnostic only.
   */
  clampResidualSeconds: number;
  /** The three terms behind `objectiveCost`, kept for explainability and for tuning w_h / w_v / w_c against real outcomes. */
  passengerCost: PassengerCost;
  /** One sentence saying why this hold was recommended, in the headways and load it was decided from (reference architecture Part J "Explainability"). Deterministic given the same inputs. */
  rationale: string;
  /**
   * How late the held vehicle already is, in seconds, at the moment of the
   * decision. Positive = behind the timetable, negative = ahead of it.
   *
   * NULL means not knowable, not on time - there is no published schedule
   * for this trip (`trips` / `trip_stop_times` are empty on this
   * deployment). Every consumer must treat null as unknown: the control
   * laws omit their schedule term and the safety filter applies no lateness
   * bound. See schedule/deviation.ts.
   */
  scheduleDeviationSeconds: number | null;
  routeDirectionId: string;
  /** ISO timestamp of the headway/vehicle-state sample the candidate was computed from - what the safety filter's staleness check is measured against. */
  stateAsOf: string;
  /** epsilon(i) = h_fwd - H* (Appendix A "headway deviation") for the pair the candidate was computed from - negative means the vehicle is bunched too close to its leader. Feeds the occupancy-weighted MPC advisory's wait-cost term and the TSP eligibility stub. */
  headwayDeviationSeconds: number;
  /** H* for the pair, carried alongside the deviation so downstream consumers (MPC advisory) don't need to re-look-up the headway state. */
  targetHeadwaySeconds: number;
}

/**
 * Is this action a hold, i.e. does its `holdSeconds` mean anything?
 *
 * Three of the five action types ask a bus to stand still for a measured
 * number of seconds. `boarding_limit` asks it to spend LESS time at a stop,
 * so its `holdSeconds` is 0 - and every check written against hold length
 * (the cap, the minimum action) has to know the difference, or it will refuse
 * a valid instruction for being zero seconds long.
 *
 * Written as a predicate on the type rather than a boolean field on the
 * candidate so it cannot disagree with `actionType` on the same object.
 */
export function isHoldAction(actionType: CandidateAction['actionType']): boolean {
  return actionType !== 'boarding_limit';
}

/** One occupancy-weighted score attached to a candidate for the PREDICTIVE advisory (blueprint 8.6, Appendix A "MPC wait cost" / "MPC onboard cost"). Advisory only - never selected as the automatic action in this ticket. */
export interface PredictiveAdvisoryCandidate {
  actionType: CandidateAction['actionType'];
  vehicleId: string;
  holdSeconds: number;
  /** Σs λs·E(hs²)/2 × w_wait term, evaluated at the current control point (horizon = 1 until a real multi-step forecast exists). */
  waitCost: number;
  /** load(i)·hold(i) × w_onboard term. */
  onboardCost: number;
  mpcObjectiveCost: number;
  /** True when occupancy for `vehicleId` was missing or older than `route_policies.occupancy_stale_seconds`, so `onboardCost` used the estimated fallback load fraction rather than a live reading. */
  occupancyEstimated: boolean;
}

export interface PredictiveAdvisory {
  /** Always 'PREDICTIVE' - never rendered or dispatched as if it were the deterministic `selectedActionType` (blueprint: "predictive models ... should follow after ... command workflow ... is in place"; this ticket ships it as an advisory signal, not a lever). */
  label: 'PREDICTIVE';
  horizonControlPoints: number;
  candidates: PredictiveAdvisoryCandidate[];
  controllerVersion: string;
}

export interface SafetyRejection {
  candidate: CandidateAction;
  reasons: SafetyRejectionReason[];
}

/**
 * `max_lateness_breach` is the punctuality guardrail: the hold is feasible
 * and safe in every other respect, but applying it would push the vehicle
 * past `route_policies.max_lateness_seconds`. Distinct from
 * `max_hold_cap_breach`, which bounds the ACTION - this bounds its
 * CONSEQUENCE for the timetable.
 */
/**
 * `cooldown_active` and `below_minimum_action` are about INSTRUCTION QUALITY
 * rather than physical safety, and they belong here for the reason the
 * literature is unanimous on: driver compliance is the dominant real-world
 * failure mode, and it is destroyed by instructions that are erratic or
 * pointless. Argote-Cabanero et al. (2015) explicitly constrain instruction
 * variability to improve it. A bus told to hold 8 seconds, or told to hold
 * again ninety seconds after the last hold, learns that the system is noise.
 */
export type SafetyRejectionReason =
  | 'stale_state'
  | 'max_hold_cap_breach'
  | 'conflicting_active_command'
  | 'max_lateness_breach'
  | 'cooldown_active'
  | 'below_minimum_action';
