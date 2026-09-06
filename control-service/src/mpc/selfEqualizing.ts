// Algorithm C - Self-equalizing control (blueprint 8.4, Appendix A):
//
//   hold(i) ~ k x max(0, h_bwd(i) - h_fwd(i))
//
// NO SCHEDULE TERM, DELIBERATELY. twoWayHold.ts and terminalDispatch.ts both
// carry a -Ks x epsilon punctuality correction; this law does not, because
// its whole premise is that the target is not to be trusted (8.4: "schedule
// targets are stale, fleet availability changes, or demand shifts
// materially"). A law chosen precisely because the timetable-derived target
// is unreliable should not then steer by that timetable. Punctuality is still
// guaranteed for its candidates - `mpc/safety.ts` applies the
// `max_lateness_breach` bound to every candidate whatever produced it, which
// is the difference between a preference and a guarantee.
//
// Used "as a robust baseline or fallback when schedule targets are stale,
// fleet availability changes, or demand shifts materially" (8.4) - here
// that translates to: only generate a self-equalizing candidate for a
// pair that two-way holding (twoWayHold.ts) could NOT cover, i.e. Kf/Kb
// are not both configured, or the backward headway sample is missing.
import { clamp } from './math.js';
import { canExecuteHold } from './eligibility.js';
import { liveOnboardCount, scoreHold } from './objective.js';
import { isScoredSelfHarmful } from './selfHarmCheck.js';
import { isWorthActingOn, occupancyAdjustedMaxHoldSeconds } from './actionThreshold.js';
import type { CandidateAction } from './types.js';
import type { HeadwayStateRow, RoutePolicyRow, VehicleStateRow } from '../state/store.js';

export function computeSelfEqualizingCandidates(
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
  /**
   * Stops each vehicle still has to serve, for the objective's waiting
   * horizon. Empty - the default - leaves every candidate on the one-stop
   * term, which is the deployed behaviour; `mpc/solver.ts` populates it only
   * when `MULTI_STOP_WAIT_TERM_ENABLED` is on, so every candidate in one
   * solve is priced under the same rule. See mpc/objective.ts.
   */
  downstreamStopsByVehicleId: ReadonlyMap<string, number | null> = new Map(),
): CandidateAction[] {
  const k = policy.selfEqualizingK;
  if (k === null) return [];

  const candidates: CandidateAction[] = [];
  for (const h of headwayStates) {
    if (terminalVehicleIds.has(h.followerVehicleId)) continue; // terminal dispatch regulation applies instead
    if (h.hFwdSeconds === null) continue; // no data at all for this pair
    // Not deviant enough to be worth an instruction - see mpc/actionThreshold.ts.
    if (!isWorthActingOn(h.hFwdSeconds, policy)) continue;
    // Same execution precondition as two-way holding - see mpc/eligibility.ts.
    if (!canExecuteHold(vehicleStatesByVehicleId.get(h.followerVehicleId), controlPointStopIds)) continue;

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

    const load = liveOnboardCount(vehicleStatesByVehicleId.get(h.followerVehicleId), policy, now, weighOccupancy);
    // The load binds on the ACTION, not just on the ranking - see
    // mpc/actionThreshold.ts for the measurement that made this necessary.
    const holdSeconds = Math.round(
      clamp(
        rawHold,
        0,
        occupancyAdjustedMaxHoldSeconds(policy.maxHoldSeconds, load, policy.occupancyCapacity),
      ),
    );
    if (holdSeconds <= 0) continue;
    // REPORTED but not used in the formula above - see this file's header.
    // Reporting it is not cosmetic: `mpc/safety.ts` reads
    // `candidate.scheduleDeviationSeconds` to apply the max-lateness bound,
    // so a candidate that carried null here would escape the one punctuality
    // guarantee that is supposed to hold across every law.
    const deviationSeconds = scheduleDeviationByVehicleId.get(h.followerVehicleId) ?? null;

    const score = scoreHold(
      h,
      h.followerVehicleId,
      holdSeconds,
      rawHold,
      load,
      deviationSeconds,
      downstreamStopsByVehicleId.get(h.followerVehicleId) ?? null,
    );
    // See mpc/selfHarmCheck.ts. Off by default; measured harmful when on.
    if (selfHarmCheckEnabled && isScoredSelfHarmful(score.objectiveCost)) continue;

    candidates.push({
      actionType: 'self_equalizing_hold',
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
