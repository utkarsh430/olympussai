// Algorithm A - Terminal dispatch regulation (blueprint 8.2, Appendix E
// "Build terminal dispatch regulation first"). At the origin, regulate
// actual departure headway rather than clock time: release the next bus
// once it has achieved the target gap to the vehicle that already left,
// bounded by the max-hold cap. This is the "default first line" control
// lever (blueprint 8.1 table) - the solver tries it before two-way/
// self-equalizing mid-route holding.
import { clamp, scheduleCorrectionSeconds } from './math.js';
import { liveOnboardCount, scoreHold } from './objective.js';
import type { CandidateAction } from './types.js';
import type { HeadwayStateRow, RoutePolicyRow, VehicleStateRow } from '../state/store.js';

/** True when `vehicleState` is currently dwelling at `terminalStopId` - the only state terminal dispatch regulation applies to. */


export function isAtTerminal(
  vehicleState: VehicleStateRow | undefined,
  terminalStopId: string | undefined,
): boolean {
  if (!vehicleState || !terminalStopId) return false;
  return vehicleState.stopState === 'dwelling_at_stop' && vehicleState.currentStopId === terminalStopId;
}

/**
 * One candidate per bus dwelling at the route-direction's origin terminal
 * whose forward gap to the already-departed predecessor is still short of
 * H* (Appendix A has no separate closed-form terminal expression; this
 * applies the same "clamp the shortfall against H*" shape as Algorithm B's
 * forward term, restricted to the origin and without the backward-pressure
 * correction, per the blueprint 8.2 description).
 */
export function computeTerminalDispatchCandidates(
  headwayStates: HeadwayStateRow[],
  vehicleStatesByVehicleId: Map<string, VehicleStateRow>,
  terminalStopId: string | undefined,
  policy: RoutePolicyRow,
  now: Date = new Date(),
  scheduleDeviationByVehicleId: ReadonlyMap<string, number | null> = new Map(),
): CandidateAction[] {
  if (!terminalStopId) return [];

  const candidates: CandidateAction[] = [];
  for (const h of headwayStates) {
    if (h.hFwdSeconds === null) continue;
    const follower = vehicleStatesByVehicleId.get(h.followerVehicleId);
    if (!isAtTerminal(follower, terminalStopId)) continue;

    // The same schedule correction the two-way law applies, and it matters
    // most here: this is the lever with no punctuality cost at all. A bus
    // still at the terminal has not started its trip, so regulating its
    // departure buys even spacing outright - which is why the literature
    // puts terminal dispatch first and why the CTA pilots measured their
    // largest wait-time reduction from terminal holding alone.
    const deviationSeconds = scheduleDeviationByVehicleId.get(h.followerVehicleId) ?? null;
    const rawHold =
      h.targetHeadwaySeconds - h.hFwdSeconds + scheduleCorrectionSeconds(policy.ks, deviationSeconds);
    if (rawHold <= 0) continue; // already spaced at or beyond target - release now, nothing to regulate

    const holdSeconds = Math.round(clamp(rawHold, 0, policy.maxHoldSeconds));
    if (holdSeconds <= 0) continue;

    const load = liveOnboardCount(follower, policy, now);

    candidates.push({
      actionType: 'terminal_dispatch_hold',
      vehicleId: h.followerVehicleId,
      involvedVehicleIds: [h.followerVehicleId, h.leaderVehicleId],
      holdSeconds,
      ...scoreHold(h, h.followerVehicleId, holdSeconds, rawHold, load, deviationSeconds),
      routeDirectionId: h.routeDirectionId,
      stateAsOf: h.computedAt,
      headwayDeviationSeconds: h.hFwdSeconds - h.targetHeadwaySeconds,
      targetHeadwaySeconds: h.targetHeadwaySeconds,
    });
  }

  return candidates.sort((a, b) => a.objectiveCost - b.objectiveCost);
}
