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
// ─── AND ABSENCE BEHIND IS NOT A GAP ON TARGET ───────────────────────────
//
// The same "absence is not zero" discipline applies to the bus BEHIND, and
// getting it wrong here priced this law - the one lever with no cost to
// anybody aboard - at exactly zero.
//
// `computePassengerCost` substitutes a neutral `h_bwd` when nothing is
// observed behind, which at an origin is the ordinary case. The mid-route
// neutral is `h_bwd = H*`: the follower sits one target headway back from
// where this vehicle IS. Apply that to an unclamped terminal hold
// `d = H* - h_fwd` and the objective's bracket is
//
//   d + h_fwd - h_bwd  =  (H* - h_fwd) + h_fwd - H*  =  0,  EXACTLY.
//
// The hold swaps the two gaps instead of evening them, so its wait term is
// exactly 0.0 - MEASURED on 43.1% / 38.9% / 46.1% of every terminal candidate
// on urban / suburban / inter-city - and `>= 0` is true of zero, so any guard
// keyed on that comparison rejects the cheapest action in the network. The
// mistake is the ANCHOR, not the value:
// mid-route `h_fwd` is measured from this vehicle, but here it is elapsed time
// from the leader's departure, an instant this hold cannot move, and the bus
// behind has not departed at all. Anchored there the neutral claim is that the
// departures either side of this one fall on target - `h_bwd = 2 x H* - h_fwd`
// - and the wait term becomes `-w_h x lambda x d^2`. Derivation and
// measurement in `mpc/objective.ts`'s header,
// docs/MULTI_STOP_WAIT_TERM.md section 5 and docs/ORIGIN_BACKWARD_NEUTRAL.md;
// switch in `ORIGIN_BACKWARD_NEUTRAL_ENABLED`.
//
// Correcting it is necessary and measured NOT sufficient: the share of terminal
// candidates priced `>= 0` goes 100.0% -> 100.0%, because occupancy-blind the
// score is `-w_h x lambda x N x d^2 + W_LATENESS x d` and a benefit needs
// `lambda x N x d > 1` - under the 1/H* proxy at N = 1, a hold longer than H*,
// which this law can never propose. The zero was what stood between the horizon
// and something to multiply.
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
import { loadEnv } from '../config/env.js';
import { isScoredSelfHarmful } from './selfHarmCheck.js';
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
  /**
   * Whether to decline a candidate this law's own objective scores as net
   * harmful, the way `mpc/costOptimalHold.ts` always has. Defaults FALSE - the
   * deployed default and today's behaviour. See mpc/selfHarmCheck.ts, and read
   * why it is off before turning it on.
   *
   * It bites hardest here of the three. Terminal dispatch is the one lever with
   * no punctuality cost - the bus has not started its trip and nobody is aboard
   * to be delayed - yet the objective still charges `w_c` for standing still
   * against a wait term it can barely see, so it prices most terminal holds as
   * harmful. Declining them removes the highest-return, lowest-cost lever the
   * literature knows of. That shows up in the measurement as the largest single
   * loss - see docs/SELF_HARM_CHECK.md.
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
  /**
   * Whether an unobserved bus behind is priced against the LEADER'S DEPARTURE
   * rather than against this standing vehicle's own position - the correction
   * described in this file's header.
   *
   * Read from `ORIGIN_BACKWARD_NEUTRAL_ENABLED` (off) once per call rather
   * than threaded down from each caller, and deliberately: `loadEnv()` is
   * cached, this is one lookup per route-direction and not per candidate, and
   * this law is the ONLY place in the system that wants the other anchor. A
   * parameter would have had to be added to every call site - the solver, the
   * decision cycle and the rehearsal adapter - to say the same thing at each
   * of them. Pass it explicitly to pin either behaviour in a test.
   */
  originBackwardNeutralEnabled: boolean = loadEnv().ORIGIN_BACKWARD_NEUTRAL_ENABLED,
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

    // The objective is scored on the DEPARTURE headway too, not on the
    // stationary bus's h_fwd. Its wait term prices the gap passengers are
    // standing through, and at the origin that gap is the elapsed one; a
    // 27,601s h_fwd fed straight into `computePassengerCost` produced an
    // objectiveCost as meaningless as the hold it never proposed.
    //
    // The backward anchor is the origin one only when the switch is on. It is
    // consulted at all only when `h.hBwdSeconds` is null - a bus that IS
    // observed behind on the corridor is priced on its measured gap either
    // way, because that is not an assumption to correct.
    const score = scoreHold(
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
      downstreamStopsByVehicleId.get(h.followerVehicleId) ?? null,
      originBackwardNeutralEnabled ? 'target_departure' : 'vehicle',
    );
    // See mpc/selfHarmCheck.ts. Off by default; measured harmful when on.
    if (selfHarmCheckEnabled && isScoredSelfHarmful(score.objectiveCost)) continue;

    candidates.push({
      actionType: 'terminal_dispatch_hold',
      vehicleId: h.followerVehicleId,
      involvedVehicleIds: [h.followerVehicleId, h.leaderVehicleId],
      holdSeconds,
      ...score,
      routeDirectionId: h.routeDirectionId,
      stateAsOf: h.computedAt,
      headwayDeviationSeconds: elapsedSinceTerminalDepartureSeconds - h.targetHeadwaySeconds,
      targetHeadwaySeconds: h.targetHeadwaySeconds,
    });
  }

  return candidates.sort((a, b) => a.objectiveCost - b.objectiveCost);
}
