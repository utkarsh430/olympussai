// Algorithm A - Terminal dispatch regulation (blueprint 8.2, Appendix E
// "Build terminal dispatch regulation first"). At the origin, regulate
// actual departure headway rather than clock time: release the next bus
// once it has achieved the target gap to the vehicle that already left.
// This is the "default first line" control lever (blueprint 8.1 table) - the
// solver tries it before two-way/self-equalizing mid-route holding.
//
// ─── WHY THIS LAW READS A DEPARTURE HEADWAY AND NOT h_fwd ────────────────
//
// It used to read `h_fwd`, and that made it incapable of ever proposing a
// hold. The chain, all of it correct in isolation:
//
//   isAtTerminal            requires stop_state = 'dwelling_at_stop'
//   stopStateClassifier     assigns that only below 2 km/h
//   computePairHeadways     floors speed at MIN_SPEED_KMPH = 1 and returns
//                           h_fwd = gap / speed
//
// so a bus standing at the origin reported h_fwd = gap x 3.6 seconds per
// metre. MEASURED: a 7.7 km gap became 27,601s against a 900s target, so
// `H* - h_fwd` was hugely negative and `rawHold <= 0` skipped every
// candidate. For h_fwd to fall under a 900s target the preceding bus would
// have had to be within 250 m of the terminal.
//
// The floor was not the bug. h_fwd is a CLOSING TIME - "how long until I
// reach where my leader is now, at my current pace" - and for a bus that is
// not moving and has not begun its trip the honest answer is infinity. The
// floor merely replaces infinity with a large finite number. The bug was
// asking a closing-time question at a place where the quantity that matters
// is ELAPSED time: how long since the previous bus pulled out.
//
// That is what blueprint 8.2 says the law regulates, and what
// `headway/stopHeadway.ts` says the blueprint asks for everywhere:
// "At stops and control points, actual departure-to-departure headway should
// be the preferred measurement. Between stops, compute model-based time
// headway using current speed, link travel-time estimates, and route
// position." Only the second sentence had ever been implemented.
//
// ─── WHY A DEPARTURE HEADWAY CAN BE A CONTROL INPUT *HERE* ───────────────
//
// `stopHeadway.ts` declines to be a control input, for a sound reason it
// states plainly: a departure-to-departure gap needs BOTH buses to have
// departed, by which point the gap is history and no hold can change it.
//
// That objection does not hold at the terminal, and the asymmetry is the
// whole basis of this law. Terminal dispatch does not need the gap between
// two completed departures. It needs "how long since the last bus left",
// measured against a bus that is STILL STANDING THERE - and the hold is
// precisely what sets the second departure time. The origin is the one place
// in the network where a departure-based headway is a live control input
// rather than a retrospective KPI.
//
// ─── ABSENCE IS NOT ZERO ─────────────────────────────────────────────────
//
// `departureHeadwaySeconds` is null when nothing has been observed to depart
// this terminal yet - a fresh deployment, a GPS gap, the first bus of the
// day. That must generate NO candidate, and it must never fall back to
// h_fwd. A null elapsed time is "we do not know how long this bus has been
// waiting", and the failure mode of guessing is a hold issued to a bus that
// left the terminal thirty seconds behind another one.
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
 * Seconds since the previous bus departed the terminal, or null when that is
 * unknown.
 *
 * Measured, not modelled: `stop_visits` rows are written only once a visit has
 * COMPLETED (`state-estimation/service.ts#recordStopVisitIfCompleted`), so the
 * most recent departure recorded at the origin belongs to the bus in front,
 * never to the one still standing there.
 */
export function departureHeadwaySeconds(
  lastTerminalDepartureAt: Date | null,
  now: Date,
): number | null {
  if (!lastTerminalDepartureAt) return null;
  const elapsed = (now.getTime() - lastTerminalDepartureAt.getTime()) / 1000;
  // A negative elapsed time means the clock and the recorded departure
  // disagree, which is a data fault rather than a bus that departed in the
  // future. Declining is the only safe reading.
  if (!Number.isFinite(elapsed) || elapsed < 0) return null;
  return elapsed;
}

/**
 * One candidate per bus dwelling at the route-direction's origin terminal
 * whose departure headway to the already-departed predecessor is still short
 * of H* (Appendix A has no separate closed-form terminal expression; this
 * applies the "clamp the shortfall against H*" shape to the ELAPSED departure
 * gap that blueprint 8.2 names, restricted to the origin and without the
 * backward-pressure correction).
 *
 * @param elapsedSinceTerminalDepartureSeconds seconds since the previous bus
 *   left this terminal, from `departureHeadwaySeconds`. Null declines.
 */
export function computeTerminalDispatchCandidates(
  headwayStates: HeadwayStateRow[],
  vehicleStatesByVehicleId: Map<string, VehicleStateRow>,
  terminalStopId: string | undefined,
  policy: RoutePolicyRow,
  now: Date = new Date(),
  scheduleDeviationByVehicleId: ReadonlyMap<string, number | null> = new Map(),
  /**
   * Whether the network-wide occupancy switch is on
   * (`control_settings.weigh_occupancy`). Defaults true so a direct caller -
   * a test, a rehearsal - keeps the unswitched behaviour; the solver always
   * passes the real setting. See mpc/objective.ts#liveOnboardCount.
   */
  weighOccupancy = true,
  elapsedSinceTerminalDepartureSeconds: number | null = null,
): CandidateAction[] {
  if (!terminalStopId) return [];
  if (elapsedSinceTerminalDepartureSeconds === null) return [];

  const candidates: CandidateAction[] = [];
  for (const h of headwayStates) {
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
      h.targetHeadwaySeconds -
      elapsedSinceTerminalDepartureSeconds +
      scheduleCorrectionSeconds(policy.ks, deviationSeconds);
    if (rawHold <= 0) continue; // already spaced at or beyond target - release now, nothing to regulate

    const holdSeconds = Math.round(clamp(rawHold, 0, policy.maxHoldSeconds));
    if (holdSeconds <= 0) continue;

    const load = liveOnboardCount(follower, policy, now, weighOccupancy);

    candidates.push({
      actionType: 'terminal_dispatch_hold',
      vehicleId: h.followerVehicleId,
      involvedVehicleIds: [h.followerVehicleId, h.leaderVehicleId],
      holdSeconds,
      // The objective is scored on the DEPARTURE headway too, not on the
      // stationary bus's h_fwd. Its wait term prices the gap passengers are
      // standing through, and at the origin that gap is the elapsed one; a
      // 27,601s h_fwd fed straight into `computePassengerCost` produced an
      // objectiveCost as meaningless as the hold it never proposed.
      ...scoreHold(
        {
          hFwdSeconds: elapsedSinceTerminalDepartureSeconds,
          hBwdSeconds: h.hBwdSeconds,
          targetHeadwaySeconds: h.targetHeadwaySeconds,
        },
        h.followerVehicleId,
        holdSeconds,
        rawHold,
        load,
        deviationSeconds,
      ),
      routeDirectionId: h.routeDirectionId,
      stateAsOf: h.computedAt,
      headwayDeviationSeconds: elapsedSinceTerminalDepartureSeconds - h.targetHeadwaySeconds,
      targetHeadwaySeconds: h.targetHeadwaySeconds,
    });
  }

  return candidates.sort((a, b) => a.objectiveCost - b.objectiveCost);
}
