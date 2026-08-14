/**
 * The driver's journey: a measured prediction and a published timetable,
 * joined per stop and kept apart.
 *
 * ─── WHY THIS IS A MODULE AND NOT THREE LINES IN A COMPONENT ─────────────
 *
 * This product's central claim is that an operator can always tell an
 * observed fact from a modelled one. On a driver's screen that claim gets its
 * hardest test: the driver wants a number, the prediction can only produce one
 * for about 14% of vehicles with a usable fix, and there is a published
 * timetable sitting right there that would fill every gap with a
 * confident-looking clock time.
 *
 * Substituting it is the single most tempting wrong thing this surface could
 * do, so the arrival API is built with nowhere to put one
 * (src/models/control.ts's arrival block, and its "has nowhere to put a
 * timetable time" test). That guarantee ends the moment something joins the
 * two datasets - which is exactly what this file does. So the join happens in
 * one named, tested place, under three rules:
 *
 *   1. The prediction is passed through UNTOUCHED. `arrival` is the object
 *      control-service sent, not a reshaped copy. Nothing here can rewrite an
 *      eta, and a test asserts object equality to keep it that way.
 *   2. The timetable lands in its own sibling field, `scheduled`. It is never
 *      written into `arrival`, never used as a fallback for a missing eta,
 *      and never merged. The renderer gets two fields and must label them
 *      differently; it cannot accidentally be handed one field that is
 *      sometimes a measurement and sometimes a timetable.
 *   3. An uncertain match produces NO timetable rather than a guessed one.
 *
 * ─── THE JOIN KEY ───────────────────────────────────────────────────────
 *
 * Both datasets key a stop on the upstream `atco_code`:
 *   - control-service `stops.id` is `String(atco_code)`, never suffixed
 *     (control-service/src/seed/harvest.ts, and the column comment on
 *     control-service/db/migrations/20260805190000__core_data_model.sql).
 *   - `CanonicalStop.id` is NOT that code. src/lib/upsrtc/normalizer.ts builds
 *     it as `${atco_code}-${stop_sequence}`, then appends `#2`, `#3`, ... to
 *     break any collision that survives, because upstream genuinely repeats a
 *     stop on a loop working. Stop 12921 at sequence 3 therefore arrives here
 *     as `12921-3`, and a second visit to it as `12921-3#2`.
 *
 * THIS COST A DEFECT, so it is written down rather than left to be rediscovered.
 * The join was first built on the assumption that both sides carried the bare
 * `atco_code` - which the schema comment on control-service's `stops.id` says,
 * and which is true of THAT side. The unit tests were written from the same
 * assumption and passed, because they asserted the assumption instead of the
 * real format. The result was a timetable that never appeared on the driver's
 * screen at all: every stop looked unmatched, silently, with a green suite. It
 * was caught by looking at the rendered page. The tests now build their
 * timetable fixtures by running `normalizeSchedulePayload` over a raw upstream
 * payload (see driverJourney.test.ts), so this file's idea of the id format and
 * the normalizer's cannot drift apart again.
 *
 * So the key is the bare code, recovered by stripping the `#n` collision suffix
 * and then the trailing `-<sequence>`. Where that leaves two or more candidates
 * for one stop, they are separated by `sequence`; where that does not separate
 * them either, rule 3 applies and the stop gets no timetable. A wrong clock
 * time beside a prediction is worse than no clock time.
 */
import type { StopArrival } from '@/models/control';
import type { CanonicalStop } from '@/models/canonical';

/**
 * The published times for one stop, as a distinct kind of claim.
 *
 * A nested object rather than two loose `scheduledArrival` / `scheduledDeparture`
 * fields on the stop: it makes "is there a timetable for this stop at all"
 * (`scheduled === null`) a single check the renderer cannot get half right,
 * and it keeps the timetable visibly a separate thing from the prediction
 * beside it.
 */
export interface ScheduledStopTimes {
  /** ISO-8601, or null where the timetable lists the stop but gives no arrival time. */
  arrival: string | null;
  departure: string | null;
}

export interface JourneyStop {
  stopId: string;
  stopName: string;
  sequence: number;
  isControlPoint: boolean;
  distanceRemainingMeters: number;
  latitude: number | null;
  longitude: number | null;
  /** Control-service's own answer, verbatim. Measured, or an explicit refusal. */
  arrival: StopArrival;
  /** The published timetable for this stop. A DIFFERENT kind of claim - never a fallback for the above. */
  scheduled: ScheduledStopTimes | null;
}

/**
 * `12921-3#2` -> `12921`. See the join-key note above.
 *
 * Only the LAST `-<digits>` group is removed, so an atco code that itself
 * contains a dash keeps it. Anchored on digits for the same reason: a code
 * ending in `-BAY` is not a sequence suffix and must survive.
 */
function bareStopCode(id: string): string {
  const withoutCollisionSuffix = id.split('#', 1)[0]!;
  return withoutCollisionSuffix.replace(/-\d+$/, '');
}

/**
 * One journey stop per predicted stop, in the prediction's own order, each
 * carrying the timetable row that unambiguously belongs to it.
 *
 * `arrivals` drives the iteration, never `scheduleStops`. That ordering is the
 * boundary property: the prediction decides which stops are ahead of this bus
 * and in what order, and the timetable is only ever an annotation on one of
 * them. Iterating the timetable instead would put stops on the driver's screen
 * that the prediction never said were ahead - including, on a loop, ones
 * already passed.
 */
export function joinScheduleToArrivals(
  arrivals: readonly StopArrival[],
  scheduleStops: readonly CanonicalStop[],
): JourneyStop[] {
  const byCode = new Map<string, CanonicalStop[]>();
  for (const stop of scheduleStops) {
    const code = bareStopCode(stop.id);
    const bucket = byCode.get(code);
    if (bucket) bucket.push(stop);
    else byCode.set(code, [stop]);
  }

  return arrivals.map((arrival) => ({
    stopId: arrival.stopId,
    stopName: arrival.stopName,
    sequence: arrival.sequence,
    isControlPoint: arrival.isControlPoint,
    distanceRemainingMeters: arrival.distanceRemainingMeters,
    latitude: arrival.latitude,
    longitude: arrival.longitude,
    arrival,
    scheduled: resolveScheduled(byCode.get(bareStopCode(arrival.stopId)), arrival.sequence),
  }));
}

/**
 * The timetable row for this stop, or null when it cannot be established.
 *
 * One candidate is the answer. Several means the working visits this physical
 * stop more than once, and only the sequence can say which visit this is; if
 * that does not separate them, this returns null rather than picking the first
 * - see rule 3.
 */
function resolveScheduled(
  candidates: readonly CanonicalStop[] | undefined,
  sequence: number,
): ScheduledStopTimes | null {
  if (!candidates || candidates.length === 0) return null;

  const chosen =
    candidates.length === 1
      ? candidates[0]!
      : (() => {
          const bySequence = candidates.filter((stop) => stop.sequence === sequence);
          return bySequence.length === 1 ? bySequence[0]! : null;
        })();

  if (!chosen) return null;
  return { arrival: chosen.scheduledArrival, departure: chosen.scheduledDeparture };
}
