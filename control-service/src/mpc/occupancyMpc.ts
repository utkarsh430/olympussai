// Algorithm E - Rolling-horizon MPC, occupancy-weighted advisory
// (blueprint 8.6, Appendix A):
//
//   Minimize: Ss [ls x E(hs^2)/2 x w_wait] + Si [load(i) x hold(i) x w_onboard] + operator_cost
//
// This ticket ships the "occupancy is central" half of that objective as
// an ADVISORY re-score of the already-safety-filtered deterministic
// candidates (terminal/two-way/self-equalizing), not a standalone
// multi-step quadratic-program solver - the blueprint explicitly sequences
// "predictive models and occupancy-weighted MPC should follow after a
// simulator, command workflow, ... is in place" (Conclusion), so wiring it
// as advisory-only here (never selected as the automatic action) matches
// that phasing. Every result carries `label: 'PREDICTIVE'` so no caller
// can mistake it for a committed recommendation.
import { clamp } from './math.js';
import type { CandidateAction, PredictiveAdvisory, PredictiveAdvisoryCandidate } from './types.js';
import type { RoutePolicyRow, VehicleStateRow } from '../state/store.js';

export const CONTROLLER_VERSION_PREDICTIVE = 'occupancy-weighted-mpc-v1';

// Passenger-wait vs. onboard-delay tradeoff weights. Appendix A leaves
// these as policy-tunable (w_wait, w_onboard); route_policies has no
// dedicated column for them yet (only the generic kpi_thresholds/
// escalation_policy jsonb blobs, which are about detection/command
// policy, not this objective), so they are fixed, named constants here
// until a route-direction actually needs to tune them.
const W_WAIT = 1;
const W_ONBOARD = 1;

/** Used when occupancy is unknown or stale: a mid-load assumption rather than treating an unread/expired sensor as either empty (under-penalizes holding a likely-loaded bus) or full (over-penalizes it). */
const ESTIMATED_LOAD_FRACTION = 0.5;

function estimateLoadFraction(
  vehicleState: VehicleStateRow | undefined,
  policy: RoutePolicyRow,
  now: Date,
): { fraction: number; estimated: boolean } {
  const capacity = policy.occupancyCapacity;
  if (!vehicleState || vehicleState.occupancyCount === null || capacity === null || capacity <= 0) {
    return { fraction: ESTIMATED_LOAD_FRACTION, estimated: true };
  }
  if (policy.occupancyStaleSeconds !== null) {
    const ageSeconds = (now.getTime() - new Date(vehicleState.observedAt).getTime()) / 1000;
    if (!Number.isFinite(ageSeconds) || ageSeconds > policy.occupancyStaleSeconds) {
      return { fraction: ESTIMATED_LOAD_FRACTION, estimated: true };
    }
  }
  return { fraction: clamp(vehicleState.occupancyCount / capacity, 0, 1), estimated: false };
}

/**
 * Re-scores each already-safety-filtered candidate with the occupancy-
 * weighted objective and returns them ranked (index 0 = MPC's preferred
 * action), clearly labelled PREDICTIVE. `horizonControlPoints` reports the
 * configured planning horizon (Appendix C) even though this single-step
 * advisory does not yet forecast multiple control points ahead.
 */
export function computePredictiveAdvisory(
  safeCandidates: CandidateAction[],
  vehicleStatesByVehicleId: Map<string, VehicleStateRow>,
  policy: RoutePolicyRow,
  now: Date = new Date(),
): PredictiveAdvisory {
  const candidates: PredictiveAdvisoryCandidate[] = safeCandidates.map((candidate) => {
    const { fraction, estimated } = estimateLoadFraction(
      vehicleStatesByVehicleId.get(candidate.vehicleId),
      policy,
      now,
    );

    // Predicted forward headway after applying the hold: h_fwd + hold.
    // E(hs^2) approximated by this single deterministic projection (no
    // variance model yet) rather than a true expectation.
    const currentHFwd = candidate.targetHeadwaySeconds + candidate.headwayDeviationSeconds;
    const predictedHFwd = currentHFwd + candidate.holdSeconds;
    // lambda_s (passenger arrival rate at the control point) approximated
    // as 1/H*, the standard headway-managed-route proxy used elsewhere in
    // this codebase's EWT computation.
    const arrivalRate = candidate.targetHeadwaySeconds > 0 ? 1 / candidate.targetHeadwaySeconds : 0;
    const waitCost = arrivalRate * (predictedHFwd ** 2) / 2 * W_WAIT;
    const onboardCost = fraction * candidate.holdSeconds * W_ONBOARD;

    return {
      actionType: candidate.actionType,
      vehicleId: candidate.vehicleId,
      holdSeconds: candidate.holdSeconds,
      waitCost,
      onboardCost,
      mpcObjectiveCost: waitCost + onboardCost,
      occupancyEstimated: estimated,
    };
  });

  candidates.sort((a, b) => a.mpcObjectiveCost - b.mpcObjectiveCost);

  return {
    label: 'PREDICTIVE',
    horizonControlPoints: policy.predictionHorizonControlPoints,
    candidates,
    controllerVersion: CONTROLLER_VERSION_PREDICTIVE,
  };
}
