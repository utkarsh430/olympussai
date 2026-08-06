// Algorithm B - Two-way headway holding (blueprint 8.3, Appendix A):
//
//   hold(i) = clamp[Kf x (H* - h_fwd(i)) - Kb x (H* - h_bwd(i)), 0, hold_max]
//
// The forward term holds a bus that is too close to its leader; the
// backward term reduces/cancels the hold when the follower behind it is
// already too close, so the controller does not export the problem
// downstream. Requires both Kf and Kb (policy-configured) and both
// forward/backward headway samples - when either is missing,
// selfEqualizing.ts is the designated fallback (Appendix E "use self-
// equalizing control as a robust baseline/fallback").
import { clamp } from './math.js';
import type { CandidateAction } from './types.js';
import type { HeadwayStateRow, RoutePolicyRow } from '../state/store.js';

export function computeTwoWayCandidates(
  headwayStates: HeadwayStateRow[],
  terminalVehicleIds: ReadonlySet<string>,
  policy: RoutePolicyRow,
): CandidateAction[] {
  if (policy.kf === null || policy.kb === null) return [];

  const candidates: CandidateAction[] = [];
  for (const h of headwayStates) {
    if (terminalVehicleIds.has(h.followerVehicleId)) continue; // terminal dispatch regulation applies instead
    if (h.hFwdSeconds === null || h.hBwdSeconds === null) continue;

    const rawHold = policy.kf * (h.targetHeadwaySeconds - h.hFwdSeconds) - policy.kb * (h.targetHeadwaySeconds - h.hBwdSeconds);
    if (rawHold <= 0) continue;

    const holdSeconds = Math.round(clamp(rawHold, 0, policy.maxHoldSeconds));
    if (holdSeconds <= 0) continue;

    candidates.push({
      actionType: 'two_way_hold',
      vehicleId: h.followerVehicleId,
      involvedVehicleIds: [h.followerVehicleId, h.leaderVehicleId],
      holdSeconds,
      objectiveCost: Math.abs(rawHold - holdSeconds),
      routeDirectionId: h.routeDirectionId,
      stateAsOf: h.computedAt,
      headwayDeviationSeconds: h.hFwdSeconds - h.targetHeadwaySeconds,
      targetHeadwaySeconds: h.targetHeadwaySeconds,
    });
  }

  return candidates.sort((a, b) => a.objectiveCost - b.objectiveCost);
}
