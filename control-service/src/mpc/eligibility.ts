// Whether a hold could actually be EXECUTED by the vehicle it names.
//
// ─── THE DEFECT THIS EXISTS TO CLOSE ─────────────────────────────────────
//
// `terminalDispatch.ts` has always checked that the bus is dwelling at the
// terminal before proposing to hold it there. `twoWayHold.ts` and
// `selfEqualizing.ts` checked nothing at all: they generated a hold for any
// leader/follower pair whose headways looked wrong, regardless of where the
// follower was or what it was doing. A bus doing 45 km/h halfway down a link
// would be told to "hold 240 seconds".
//
// Nothing downstream caught it either - the hard safety filter grades
// staleness, hold caps, conflicting commands and lateness, and the command
// path validates none of it. The instruction reached a dispatcher looking
// exactly like an executable one.
//
// On a network whose median planned headway is 1,800 s, buses spend most of
// their time between stops, so the MAJORITY of proposed mid-route holds
// named a vehicle that could not act on them. That is not a cosmetic problem:
// driver compliance is the dominant real-world failure mode for this entire
// class of system, and the fastest way to destroy it is to send instructions
// that cannot be followed. Phillips et al. (2015) found that randomly
// distributed non-compliance costs little, but that PERMANENTLY
// non-compliant vehicles cause a substantial performance drop - and a driver
// who has learned the instructions are nonsense becomes exactly that.
//
// ─── WHY THIS SKIPS RATHER THAN REJECTS ──────────────────────────────────
//
// A candidate that fails here is never generated, rather than generated and
// rejected with a reason the way `safety.ts` handles its checks. The
// distinction is deliberate and matches how `isAtTerminal` already behaves:
//
//   Being mid-link is the NORMAL state of most buses most of the time. It is
//   not a guardrail firing, it is the absence of an opportunity, and
//   surfacing twenty "could not hold, bus was moving" rejections per solve
//   would bury the handful of rejections that are genuinely news.
//
// Cooldown and minimum-action, by contrast, ARE policy decisions about a
// candidate that could otherwise have been acted on, so those live in
// `safety.ts` and are reported.
import type { VehicleStateRow } from '../state/store.js';

/**
 * Stop states in which a hold instruction can actually be carried out.
 *
 * `approaching_stop` is included, and is arguably the BEST moment to issue
 * one: the driver receives the instruction before they arrive and can plan
 * for it, rather than being asked to sit still after they had already
 * decided to pull away. `dwelling_at_stop` is the obvious case.
 *
 * Everything else is excluded for a specific reason rather than by default:
 *
 *   departed_stop        already pulling away; the moment has passed
 *   stopped_in_traffic   stationary, but not where passengers can board, and
 *                        holding here blocks a running lane
 *   off_route            position is not trustworthy enough to act on
 *   held_by_controller   a hold is already in progress; a second instruction
 *                        on top of it is the `conflicting_active_command`
 *                        case the safety filter names
 */
const HOLDABLE_STOP_STATES: ReadonlySet<string> = new Set(['approaching_stop', 'dwelling_at_stop']);

/**
 * The stop a hold on this vehicle would be executed at, or null if there
 * isn't one.
 *
 * @param controlPointStopIds stops flagged `route_direction_stops.is_control_point`
 *   for this route-direction. An EMPTY set means the corridor has designated
 *   no control points, and is treated as "hold at any stop" rather than
 *   "hold nowhere" - a corridor that has never been surveyed must not be
 *   silently switched off, which is the failure mode a fail-closed default
 *   would produce on the 47-shaped-vs-14-policied split this network
 *   actually has.
 */
export function holdExecutionStopId(
  vehicleState: VehicleStateRow | undefined,
  controlPointStopIds: ReadonlySet<string>,
): string | null {
  if (!vehicleState) return null;
  if (!HOLDABLE_STOP_STATES.has(vehicleState.stopState)) return null;
  if (!vehicleState.currentStopId) return null;

  // Control-point PLACEMENT matters more than control-point count: holding
  // at three stops early in a 47-stop route produced route-long wait-time
  // benefit in the CTA pilot, while holding everywhere spends driver
  // goodwill and intervention budget where it achieves nothing. Where a
  // corridor has designated its points, respect them.
  if (controlPointStopIds.size > 0 && !controlPointStopIds.has(vehicleState.currentStopId)) {
    return null;
  }

  return vehicleState.currentStopId;
}

/** Convenience predicate for the control laws. */
export function canExecuteHold(
  vehicleState: VehicleStateRow | undefined,
  controlPointStopIds: ReadonlySet<string>,
): boolean {
  return holdExecutionStopId(vehicleState, controlPointStopIds) !== null;
}
