// How late a bus is, in seconds. Pure - no I/O.
//
// ─── THE DEFINITION, AND WHY IT IS THIS ONE ──────────────────────────────
//
//   epsilon = now - (the time the timetable says this bus should have
//                    reached the point it is actually at)
//
// Positive is late, negative is early, and the units are seconds either way.
//
// The obvious alternative - "actual arrival at the last stop minus scheduled
// arrival at that stop" - is the textbook definition and it is the one to
// switch to once a stop-crossing log exists. It cannot be computed here yet:
// nothing in this system records when a vehicle actually reached a stop
// (`vehicle_states.stop_state_entered_at` is current-state, overwritten on
// every fix, and there is no append-only crossing table). This definition
// needs only the schedule curve and a live distance-along-route, both of
// which exist today, and it has a property the stop-based one lacks: it
// updates continuously between stops rather than stepping once per stop,
// so a controller deciding mid-link is not reasoning from a reading taken
// several kilometres ago.
//
// ─── THE SCHEDULE CURVE ──────────────────────────────────────────────────
//
// A trip's timetable, expressed as the monotone function
//
//   distance-along-route  ->  the instant the bus should be there
//
// built from `trip_stop_times` joined to `route_direction_stops`
// (cumulative_distance_meters). Between two consecutive stops the bus is
// assumed to cover the link at a constant pace, which is the same modelling
// step `simulation/kinematics.ts` documents for the same reason: the inputs
// are per-stop times, not speed profiles.
//
// ─── NULL IS A REAL ANSWER ───────────────────────────────────────────────
//
// Every function here returns null rather than a number whenever the honest
// answer is "unknown": no schedule loaded, the vehicle is not on a trip, it
// has not left the origin, it has finished, or the curve is unusable. Null
// propagates all the way to the control laws, which omit the schedule term,
// and to the safety filter, which applies no lateness bound. That is the
// designed degradation - `trips` and `trip_stop_times` are empty on this
// deployment, so null is what every vehicle reports today and the deployed
// behaviour is unchanged until a timetable is loaded.
//
// A deviation invented from an assumption would be worse than none: it would
// shorten holds on buses nobody has established are late, and it would let
// the max-lateness guardrail vouch for a bound it cannot actually measure.

/** One scheduled point on a trip: where the bus should be, and when. */
export interface ScheduledPoint {
  /** `route_direction_stops.cumulative_distance_meters` for this stop. */
  distanceMeters: number;
  /**
   * When the bus should leave this stop, as epoch milliseconds. Scheduled
   * DEPARTURE is used in preference to arrival - a bus is "on time" at a stop
   * it is still due to be sitting at, so measuring against arrival would
   * report every scheduled dwell as lateness.
   */
  epochMs: number;
}

/**
 * A trip's timetable as a monotone distance -> time curve.
 *
 * `points` must be sorted by `distanceMeters` ascending and both series must
 * be strictly increasing; `buildScheduleCurve` is the only thing that should
 * construct one, and it enforces that.
 */
export interface ScheduleCurve {
  tripId: string;
  points: readonly ScheduledPoint[];
}

/**
 * Builds a usable curve from raw stop times, or returns null.
 *
 * Rejects rather than repairs. A timetable whose times run backwards against
 * its own stop order is not a timetable this can interpolate, and silently
 * sorting or dropping points would produce a curve that disagrees with the
 * published schedule the operator is being measured against. Two points are
 * the minimum that define a segment.
 */
export function buildScheduleCurve(
  tripId: string,
  points: readonly ScheduledPoint[],
): ScheduleCurve | null {
  const usable = points.filter(
    (p) => Number.isFinite(p.distanceMeters) && Number.isFinite(p.epochMs),
  );
  if (usable.length < 2) return null;

  const sorted = [...usable].sort((a, b) => a.distanceMeters - b.distanceMeters);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    // Equal distances (two stops surveyed at the same point) or non-advancing
    // times make the segment non-invertible - there is no single instant the
    // bus should be at that distance.
    if (cur.distanceMeters <= prev.distanceMeters) return null;
    if (cur.epochMs <= prev.epochMs) return null;
  }

  return { tripId, points: sorted };
}

/**
 * The instant the schedule says the bus should be at `distanceMeters`, or
 * null when that distance is outside the trip.
 *
 * Deliberately does NOT extrapolate beyond the first or last stop. Before the
 * origin the trip has not started and there is no scheduled position to be
 * behind; past the final stop it is over. Extending the curve would invent a
 * lateness for a bus that is laying over, which is the reading most likely to
 * trigger a hold on a vehicle that needs none.
 */
export function scheduledEpochMsAt(
  curve: ScheduleCurve,
  distanceMeters: number,
): number | null {
  const points = curve.points;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (!Number.isFinite(distanceMeters)) return null;
  if (distanceMeters < first.distanceMeters || distanceMeters > last.distanceMeters) return null;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    if (distanceMeters > cur.distanceMeters) continue;
    const span = cur.distanceMeters - prev.distanceMeters;
    const fraction = span > 0 ? (distanceMeters - prev.distanceMeters) / span : 0;
    return prev.epochMs + fraction * (cur.epochMs - prev.epochMs);
  }

  return last.epochMs;
}

/**
 * Seconds this vehicle is behind its timetable. Positive = late, negative =
 * early, null = not knowable.
 *
 * @param curve                 the trip's schedule, or null when none is loaded.
 * @param distanceAlongRouteMeters  the vehicle's live position, or null.
 * @param now                   the instant to measure at.
 */
export function computeScheduleDeviationSeconds(
  curve: ScheduleCurve | null,
  distanceAlongRouteMeters: number | null,
  now: Date,
): number | null {
  if (!curve || distanceAlongRouteMeters === null) return null;
  const scheduledMs = scheduledEpochMsAt(curve, distanceAlongRouteMeters);
  if (scheduledMs === null) return null;

  const deviation = (now.getTime() - scheduledMs) / 1000;
  return Number.isFinite(deviation) ? deviation : null;
}

/**
 * Whether holding `vehicleId` for `holdSeconds` would push it past the
 * corridor's lateness bound.
 *
 * Returns false - permitting the hold - whenever the bound or the deviation
 * is unknown. That is not the filter failing open by accident: an unmeasured
 * bound cannot reject anything without inventing the measurement, and the
 * hold is still bounded by `max_hold_seconds`, which is never null. The
 * absence is visible instead, on the candidate's own `scheduleDeviationSeconds`
 * being null, rather than buried in a rejection nobody can explain.
 */
export function wouldBreachLateness(
  deviationSeconds: number | null,
  holdSeconds: number,
  maxLatenessSeconds: number | null,
): boolean {
  if (deviationSeconds === null || maxLatenessSeconds === null) return false;
  return deviationSeconds + holdSeconds > maxLatenessSeconds;
}
