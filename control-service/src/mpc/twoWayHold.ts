// Algorithm B - Two-way headway holding (blueprint 8.3, Appendix A):
//
//   hold(i) = clamp[Kf x (H* - h_fwd(i)) - Kb x (H* - h_bwd(i)) - Ks x eps(i), 0, hold_max]
//
// The forward term holds a bus that is too close to its leader; the
// backward term reduces/cancels the hold when the follower behind it is
// already too close, so the controller does not export the problem
// downstream. Requires both Kf and Kb (policy-configured) and both
// forward/backward headway samples - when either is missing,
// selfEqualizing.ts is the designated fallback (Appendix E "use self-
// equalizing control as a robust baseline/fallback").
import { clamp, scheduleCorrectionSeconds } from './math.js';
import { canExecuteHold } from './eligibility.js';
import { liveOnboardCount, scoreHold } from './objective.js';
import { isScoredSelfHarmful } from './selfHarmCheck.js';
import { isWorthActingOn, occupancyAdjustedMaxHoldSeconds } from './actionThreshold.js';
import type { CandidateAction } from './types.js';
import type { HeadwayStateRow, RoutePolicyRow, VehicleStateRow } from '../state/store.js';



export function computeTwoWayCandidates(
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
   * Whether to decline a candidate this law's own objective scores as net
   * harmful, the way `mpc/costOptimalHold.ts` always has. Defaults FALSE - the
   * deployed default and today's behaviour - so a direct caller keeps the
   * unchecked law. See mpc/selfHarmCheck.ts, and read why it is off before
   * turning it on.
   */
  selfHarmCheckEnabled = false,
): CandidateAction[] {
  if (policy.kf === null || policy.kb === null) return [];

  const candidates: CandidateAction[] = [];
  for (const h of headwayStates) {
    if (terminalVehicleIds.has(h.followerVehicleId)) continue; // terminal dispatch regulation applies instead
    if (h.hFwdSeconds === null || h.hBwdSeconds === null) continue;
    // Not deviant enough to be worth an instruction - see mpc/actionThreshold.ts.
    if (!isWorthActingOn(h.hFwdSeconds, policy)) continue;
    // A hold is executed by standing still at a stop. Proposing one to a bus
    // mid-link names an action its driver cannot take - see mpc/eligibility.ts.
    if (!canExecuteHold(vehicleStatesByVehicleId.get(h.followerVehicleId), controlPointStopIds)) continue;

    const deviationSeconds = scheduleDeviationByVehicleId.get(h.followerVehicleId) ?? null;
    const rawHold =
      policy.kf * (h.targetHeadwaySeconds - h.hFwdSeconds) -
      policy.kb * (h.targetHeadwaySeconds - h.hBwdSeconds) +
      scheduleCorrectionSeconds(policy.ks, deviationSeconds);
    if (rawHold <= 0) continue;

    const load = liveOnboardCount(vehicleStatesByVehicleId.get(h.followerVehicleId), policy, now, weighOccupancy);
    // The load binds on the ACTION, not just on the ranking - see
    // mpc/actionThreshold.ts for the measurement that made this necessary.
    const holdCapSeconds = occupancyAdjustedMaxHoldSeconds(
      policy.maxHoldSeconds,
      load,
      policy.occupancyCapacity,
    );
    const holdSeconds = Math.round(clamp(rawHold, 0, holdCapSeconds));
    if (holdSeconds <= 0) continue;

    const score = scoreHold(h, h.followerVehicleId, holdSeconds, rawHold, load, deviationSeconds);
    // The law declining an action its own objective prices as doing no good -
    // see mpc/selfHarmCheck.ts. Off by default and measured to be harmful when
    // on, because the objective's benefit term is a one-stop estimate of a
    // multi-stop benefit; the switch exists so that stays measurable.
    if (selfHarmCheckEnabled && isScoredSelfHarmful(score.objectiveCost)) continue;

    candidates.push({
      actionType: 'two_way_hold',
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
