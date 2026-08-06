// Shared types for the decision engine (blueprint section 8: terminal
// dispatch regulation, two-way holding, self-equalizing fallback,
// occupancy-weighted MPC advisory) plus the hard safety filter (blueprint
// 9.1 step 5 "safety & feasibility filter"). Split out from solver.ts so
// each control-law module (terminalDispatch.ts, twoWayHold.ts,
// selfEqualizing.ts, safety.ts, occupancyMpc.ts) can import the shape
// without a circular import back through solver.ts.

/** One committable candidate action, per Appendix A / blueprint 8.2-8.4. */
export interface CandidateAction {
  actionType: 'terminal_dispatch_hold' | 'two_way_hold' | 'self_equalizing_hold';
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
   * |idealHold - appliedHold|: 0 when the clamped/rounded hold exactly
   * matches the formula's raw output, positive when the max-hold cap or
   * rounding pulled it away from ideal. Candidates are ranked lowest cost
   * first, matching blueprint 9.1 step 6 "optimize_passenger_and_operator_cost".
   */
  objectiveCost: number;
  routeDirectionId: string;
  /** ISO timestamp of the headway/vehicle-state sample the candidate was computed from - what the safety filter's staleness check is measured against. */
  stateAsOf: string;
  /** epsilon(i) = h_fwd - H* (Appendix A "headway deviation") for the pair the candidate was computed from - negative means the vehicle is bunched too close to its leader. Feeds the occupancy-weighted MPC advisory's wait-cost term and the TSP eligibility stub. */
  headwayDeviationSeconds: number;
  /** H* for the pair, carried alongside the deviation so downstream consumers (MPC advisory) don't need to re-look-up the headway state. */
  targetHeadwaySeconds: number;
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

export type SafetyRejectionReason = 'stale_state' | 'max_hold_cap_breach' | 'conflicting_active_command';
