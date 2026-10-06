import { haversineKm } from '../infer/geo';
import { MINUTES_PER_DAY, MINUTES_PER_HOUR } from '@/lib/depot/units';

/**
 * Which stop positions fit the timetable. The corporation's stop list sometimes
 * places a stop at a same-named place elsewhere in the state, hundreds of
 * kilometres off the line of the route, yet reached and left within minutes.
 * Such a position is treated like a missing one for every distance, terminal
 * and nearest-stop figure. Pure and deterministic.
 */

/**
 * The fastest straight-line speed a bus can be credited with between two stops.
 * The top legal speed for a bus in India is 100 km/h, on an expressway; a straight
 * line is never longer than the road, so a real pair of stops always needs less.
 * The extra tenth covers scheduled times rounded to the minute and a stop placed
 * at its town's centre rather than its stand.
 */
export const MAX_PLAUSIBLE_SPEED_KMH = 110;

/**
 * How far apart two stops may be when the timetable cannot time the leg between
 * them: a missing or unreadable time, or both in the same scheduled minute. It is
 * also the floor for every timed leg, so a few minutes' gap never rejects a nearby
 * stop. Consecutive stops on the corporation's routes are well within it; the
 * misplaced stops found so far sit 130 to 270 km from the line of their route.
 */
export const UNTIMED_LEG_ALLOWANCE_KM = 40;

/** A stop with a usable position, in sequence order, and its scheduled time. */
export interface PlacedStop {
  readonly lat: number;
  readonly lng: number;
  /** Scheduled wall-clock time, `HH:MM` or `HH:MM:SS`. */
  readonly scheduled: string | null;
}

const TIME_PATTERN = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const SECONDS_PER_MINUTE = 60;
/** Fewer usable times than this and the timetable cannot judge any position. */
const MIN_TIMED_STOPS = 2;
/** A chain shorter than this confirms no position: one stop alone fits nothing. */
const MIN_CHAIN_STOPS = 2;

/** Minutes after midnight for an `HH:MM[:SS]` wall-clock string, else null. */
export function parseWallClockMinutes(value: string | null): number | null {
  if (value === null) return null;
  const match = TIME_PATTERN.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? 0);
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return hours * MINUTES_PER_HOUR + minutes + seconds / SECONDS_PER_MINUTE;
}

/** Scheduled minutes from one stop to a later one; a negative gap runs past midnight. */
function elapsedMin(from: number | null, to: number | null): number | null {
  if (from === null || to === null) return null;
  const gap = to - from;
  return gap < 0 ? gap + MINUTES_PER_DAY : gap;
}

/** The farthest apart two stops can plausibly be, given the time between them. */
export function plausibleLegKm(minutes: number | null): number {
  if (minutes === null) return UNTIMED_LEG_ALLOWANCE_KM;
  return Math.max(UNTIMED_LEG_ALLOWANCE_KM, (MAX_PLAUSIBLE_SPEED_KMH * minutes) / MINUTES_PER_HOUR);
}

interface ChainEnd {
  readonly count: number;
  readonly km: number;
  readonly previous: number;
}

const better = (a: ChainEnd, b: ChainEnd | null): boolean =>
  b === null || a.count > b.count || (a.count === b.count && a.km < b.km);

/**
 * For each stop (given in sequence order), whether its position fits the
 * timetable. The kept stops are the largest chain, in sequence order, in which
 * every consecutive pair is within `plausibleLegKm` of the scheduled time between
 * them. Ties go to the chain with the shorter straight-line length (a misplaced
 * stop adds distance), then to the chain whose stops come earliest. With fewer than
 * two usable times the timetable can judge nothing, so every stop is kept; with no
 * fitting pair among two or more stops, none is kept. Quadratic in the stop count,
 * which is a few dozen and at most a few hundred.
 */
export function positionsFitTimetable(stops: readonly PlacedStop[]): readonly boolean[] {
  const times = stops.map((stop) => parseWallClockMinutes(stop.scheduled));
  if (times.filter((time) => time !== null).length < MIN_TIMED_STOPS) return stops.map(() => true);
  const ends: ChainEnd[] = [];
  stops.forEach((to, j) => {
    let best: ChainEnd = { count: 1, km: 0, previous: -1 };
    for (let i = 0; i < j; i += 1) {
      const from = stops[i]!;
      const km = haversineKm(from.lat, from.lng, to.lat, to.lng);
      if (!(km <= plausibleLegKm(elapsedMin(times[i]!, times[j]!)))) continue;
      const candidate = { count: ends[i]!.count + 1, km: ends[i]!.km + km, previous: i };
      if (better(candidate, best)) best = candidate;
    }
    ends.push(best);
  });
  let last = -1;
  ends.forEach((end, index) => {
    if (better(end, ends[last] ?? null)) last = index;
  });
  const fits = stops.map(() => false);
  if ((ends[last]?.count ?? 0) < MIN_CHAIN_STOPS) return fits;
  for (let at = last; at >= 0; at = ends[at]!.previous) fits[at] = true;
  return fits;
}
