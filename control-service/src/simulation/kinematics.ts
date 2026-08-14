// Where a simulated vehicle is, and how fast it is going, at an arbitrary
// instant of simulated time.
//
// WHY THIS EXISTS
//
// The engine records ARRIVALS and DEPARTURES at stops. The deployed control
// laws do not consume arrivals: `src/headway/metrics.ts` measures a gap in
// METRES between a leader and its follower at ONE instant, and divides that
// gap by each vehicle's own speed to get h_fwd and h_bwd. Without a way to
// ask "where was the leader at 11:42:07", a simulator controller can only
// approximate that computation, and an approximation of a control law is
// not a rehearsal of it.
//
// The interpolation below is the modelling step, and it is a real one:
// between two stops a vehicle is assumed to cover the link at a CONSTANT
// pace, because the engine samples a link travel TIME and never a speed
// profile. Anyone reading a rehearsal result should know that its speeds are
// link averages, not instantaneous readings. Everything else here - stop
// positions, link distances, the corridor's total length - is measured
// geometry passed straight through.
//
// Isolation: pure, no imports outside this module's own types. Nothing in
// `simulation/**` may import `../db`, `../state`, `../routes`, `../webhooks`
// or `../mpc` - see the header of types.ts.
import type { CorridorKinematicState, StopVisitRecord } from './types.js';

/** Metres per second -> km/h, the unit `vehicle_states.speed_kmph` and every deployed consumer use. */
function toKmph(metersPerSecond: number): number {
  return metersPerSecond * 3.6;
}

/**
 * Average pace over a link, or null when the link took no time at all.
 *
 * Null rather than Infinity on a zero-duration link: an unbounded speed
 * would sail through `computePairHeadways`'s MIN_SPEED_KMPH floor and
 * produce a headway of approximately zero, which reads as the most severe
 * bunching the system can report. "We do not know this vehicle's pace" is
 * the truthful answer and is one the deployed pipeline already handles.
 */
function paceKmph(distanceMeters: number, durationSeconds: number): number | null {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) return null;
  return toKmph(distanceMeters / durationSeconds);
}

/**
 * The vehicle's position and pace at `atSeconds`, or null when it is not on
 * the corridor at that instant.
 *
 * Null covers two genuinely different situations that have the same
 * consequence for a controller - the vehicle has not left the terminal yet,
 * and the vehicle has finished its trip - and one that must never be papered
 * over: a timeline with no visits at all. In every case there is no vehicle
 * to measure a gap against, and the deployed pipeline's answer to that is to
 * emit no headway state for the pair rather than to substitute a position.
 *
 * @param timeline           this vehicle's own stop visits, in stop order.
 * @param dispatchSeconds    when it left the terminal (route distance 0).
 * @param cumulativeDistanceMeters  distance of each stop index along the route.
 */
export function corridorStateAt(
  timeline: readonly StopVisitRecord[],
  dispatchSeconds: number,
  cumulativeDistanceMeters: readonly number[],
  atSeconds: number,
): Omit<CorridorKinematicState, 'vehicleId'> | null {
  const first = timeline[0];
  if (!first) return null;
  if (atSeconds < dispatchSeconds) return null;

  // Terminal -> first stop. The terminal is route distance 0 by definition
  // (`route_direction_stops` sequence 0 is the origin terminal, and the
  // engine's links[0] is the leg into stops[0]).
  const firstDistance = cumulativeDistanceMeters[first.stopIndex];
  if (firstDistance === undefined) return null;
  if (atSeconds < first.arrivalSeconds) {
    const legSeconds = first.arrivalSeconds - dispatchSeconds;
    const speedKmph = paceKmph(firstDistance, legSeconds);
    const fraction = legSeconds > 0 ? (atSeconds - dispatchSeconds) / legSeconds : 0;
    return { distanceAlongRouteMeters: firstDistance * fraction, speedKmph };
  }

  for (let i = 0; i < timeline.length; i++) {
    const visit = timeline[i];
    if (!visit) continue;
    const distance = cumulativeDistanceMeters[visit.stopIndex];
    if (distance === undefined) return null;

    // Dwelling (or held) at the stop. Speed is genuinely zero here, not
    // unknown, and that distinction matters downstream: `computePairHeadways`
    // floors a stationary vehicle at MIN_SPEED_KMPH and returns a large
    // finite headway, which is the correct reading for a bus that is not
    // closing on its leader at all.
    if (atSeconds <= visit.departureSeconds) {
      return { distanceAlongRouteMeters: distance, speedKmph: 0 };
    }

    const next = timeline[i + 1];
    if (!next) break; // past the last departure - handled below.
    const nextDistance = cumulativeDistanceMeters[next.stopIndex];
    if (nextDistance === undefined) return null;
    if (atSeconds < next.arrivalSeconds) {
      const legSeconds = next.arrivalSeconds - visit.departureSeconds;
      const legMeters = nextDistance - distance;
      const speedKmph = paceKmph(legMeters, legSeconds);
      const fraction = legSeconds > 0 ? (atSeconds - visit.departureSeconds) / legSeconds : 0;
      return { distanceAlongRouteMeters: distance + legMeters * fraction, speedKmph };
    }
  }

  // Past the final departure: the trip is over and the vehicle is no longer
  // a leader anyone is following.
  return null;
}
