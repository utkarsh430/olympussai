import type { CanonicalStop } from '@/models/canonical';
import { formatFeedTime } from '@/lib/depot/format';
import { haversineKm } from '@/lib/depot/infer/geo';

export type NextStopMethod = 'position' | 'schedule';

export interface NextStop {
  readonly stop: CanonicalStop;
  readonly method: NextStopMethod;
}

export interface BusPosition {
  readonly latitude: number;
  readonly longitude: number;
}

type LocatedStop = CanonicalStop & { readonly latitude: number; readonly longitude: number };

const MIN_LOCATED_STOPS = 2;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const TIME_PATTERN = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const NO_TIME = '—';

/**
 * The HH:MM of the feed's own timestamp, digits as written (the feed stamps
 * wall-clock times with a misleading `Z`, so no timezone conversion is made).
 */
export function feedTimeOfDay(feedNow: string | null): string | null {
  const time = formatFeedTime(feedNow);
  return time === NO_TIME ? null : time;
}

function isLocated(stop: CanonicalStop): stop is LocatedStop {
  return Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude);
}

function isUsablePosition(position: BusPosition | null): position is BusPosition {
  return (
    position !== null && Number.isFinite(position.latitude) && Number.isFinite(position.longitude)
  );
}

function seconds(time: string | null): number | null {
  const match = time === null ? null : TIME_PATTERN.exec(time);
  if (!match) return null;
  return (
    Number(match[1]) * SECONDS_PER_HOUR +
    Number(match[2]) * SECONDS_PER_MINUTE +
    Number(match[3] ?? 0)
  );
}

const distance = (a: BusPosition, b: BusPosition): number =>
  haversineKm(a.latitude, a.longitude, b.latitude, b.longitude);

/**
 * By position. Take the located stop nearest the bus (the lower sequence wins a
 * tie). Then say which side of it the bus is on, using straight-line distances:
 * - the bus is beyond that stop when it is nearer to the following located
 *   stop than that stop itself is; the next stop is then the following one;
 * - with no following stop (nearest is the last), the bus is beyond it unless
 *   it is nearer to the preceding stop than the last stop is: then it is still
 *   approaching, otherwise it has finished the route and there is no next stop;
 * - otherwise the bus is at or before the nearest stop, which is the next one.
 */
function byPosition(
  located: readonly LocatedStop[],
  position: BusPosition,
): CanonicalStop | null {
  let nearest = -1;
  let nearestKm = Number.POSITIVE_INFINITY;
  located.forEach((stop, index) => {
    const km = distance(position, stop);
    if (km < nearestKm) {
      nearest = index;
      nearestKm = km;
    }
  });
  const stop = located[nearest];
  if (!stop) return null;
  const following = located[nearest + 1];
  if (following) {
    return distance(position, following) < distance(stop, following) ? following : stop;
  }
  const preceding = located[nearest - 1];
  return preceding && distance(position, preceding) < distance(stop, preceding) ? stop : null;
}

/** By schedule: the first stop whose scheduled time is later than the feed's time of day. */
function bySchedule(
  stops: readonly CanonicalStop[],
  timeOfDay: string | null,
): CanonicalStop | null {
  const now = seconds(timeOfDay);
  if (now === null) return null;
  return (
    stops.find((stop) => {
      const at = seconds(stop.scheduledArrival ?? stop.scheduledDeparture);
      return at !== null && at > now;
    }) ?? null
  );
}

/**
 * The stop a bus is heading for. By position when the bus has a position and
 * the route has at least two located stops; otherwise by the timetable. Null
 * when neither can say, or when the bus has passed the last stop. Overnight
 * services that run past midnight are not wrapped: times are compared as given.
 */
export function inferNextStop(
  stops: readonly CanonicalStop[],
  position: BusPosition | null,
  timeOfDay: string | null,
): NextStop | null {
  const ordered = [...stops].sort((a, b) => a.sequence - b.sequence);
  const located = ordered.filter(isLocated);
  if (isUsablePosition(position) && located.length >= MIN_LOCATED_STOPS) {
    const stop = byPosition(located, position);
    return stop ? { stop, method: 'position' } : null;
  }
  const stop = bySchedule(ordered, timeOfDay);
  return stop ? { stop, method: 'schedule' } : null;
}
