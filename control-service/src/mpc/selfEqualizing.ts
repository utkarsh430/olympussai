// Algorithm C - Self-equalizing control (blueprint 8.4, Appendix A):
//
//   hold(i) ~ k x max(0, h_bwd(i) - h_fwd(i))
//
// Used "as a robust baseline or fallback when schedule targets are stale,
// fleet availability changes, or demand shifts materially" (8.4) - here
// that translates to: only generate a self-equalizing candidate for a
// pair that two-way holding (twoWayHold.ts) could NOT cover, i.e. Kf/Kb
// are not both configured, or the backward headway sample is missing.
import { clamp } from './math.js';
import type { CandidateAction } from './types.js';
import type { HeadwayStateRow, RoutePolicyRow } from '../state/store.js';

export function computeSelfEqualizingCandidates(
  headwayStates: HeadwayStateRow[],
  terminalVehicleIds: ReadonlySet<string>,
  policy: RoutePolicyRow,
): CandidateAction[] {
  const k = policy.selfEqualizingK;
  if (k === null) return [];

  const candidates: CandidateAction[] = [];
  for (const h of headwayStates) {
    if (terminalVehicleIds.has(h.followerVehicleId)) continue; // terminal dispatch regulation applies instead
    if (h.hFwdSeconds === null) continue; // no data at all for this pair

    const twoWayCovers = policy.kf !== null && policy.kb !== null && h.hBwdSeconds !== null;
    if (twoWayCovers) continue; // two-way already handles this pair - self-equalizing is the fallback, not a duplicate

    // Appendix A requires h_bwd. When it is unavailable (the exact
    // "target headway or demand model is unreliable" case 8.4 calls out),
    // degrade gracefully by assuming the unseen backward neighbor sits
    // exactly on target headway (a neutral assumption: no backward
    // pressure either way) rather than refusing to act.
    const hBwd = h.hBwdSeconds ?? h.targetHeadwaySeconds;
    const rawHold = k * Math.max(0, hBwd - h.hFwdSeconds);
    if (rawHold <= 0) continue;

    const holdSeconds = Math.round(clamp(rawHold, 0, policy.maxHoldSeconds));
    if (holdSeconds <= 0) continue;

    candidates.push({
      actionType: 'self_equalizing_hold',
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
