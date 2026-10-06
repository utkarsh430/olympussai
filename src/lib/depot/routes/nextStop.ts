import type { CanonicalStop } from '@/models/canonical';
import { formatFeedTime } from '@/lib/depot/format';
import { haversineKm } from '@/lib/depot/infer/geo';
import { REPORTING_WINDOW_MIN } from '@/lib/depot/infer/thresholds';
import { lastHeardText } from '@/lib/depot/roster/rosterModel';
import type { BusOpState } from '@/lib/depot/types';
import { judgedTime, positionsFitTimetable } from './timetableFit';

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

/**
 * The located stops whose position fits the timetable, by the rule the route
 * profile uses: a stop placed at a same-named place elsewhere is never the
 * nearest stop and never widens the longest gap.
 */
function fittingStops(located: readonly LocatedStop[]): readonly LocatedStop[] {
  const fits = positionsFitTimetable(
    located.map((stop) => ({ lat: stop.latitude, lng: stop.longitude, scheduled: judgedTime(stop) })),
  );
  return located.filter((_, index) => fits[index]);
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

export interface NextStopBus {
  readonly position: BusPosition | null;
  readonly gpsAgeMin: number | null;
  readonly state: BusOpState;
}

export interface NextStopResolution {
  readonly next: NextStop | null;
  /** One sentence for why a position was not used, or why there is no next stop. */
  readonly reason: string | null;
}

const TRUSTED_STATES: readonly BusOpState[] = ['in_service', 'on_road'];

/** The longest straight-line gap between consecutive located stops, in km. */
function longestGapKm(located: readonly LocatedStop[]): number {
  return located.reduce((longest, stop, index) => {
    const previous = located[index - 1];
    return previous ? Math.max(longest, distance(previous, stop)) : longest;
  }, 0);
}

function nearestKm(located: readonly LocatedStop[], position: BusPosition): number {
  return Math.min(...located.map((stop) => distance(position, stop)));
}

/** Why a position cannot be trusted for this bus, or null when it can. */
function positionDistrust(
  bus: NextStopBus,
  located: readonly LocatedStop[],
  position: BusPosition,
): string | null {
  if (bus.gpsAgeMin === null || !Number.isFinite(bus.gpsAgeMin)) {
    return "This bus's last report time is unknown.";
  }
  if (bus.gpsAgeMin > REPORTING_WINDOW_MIN) {
    return `This bus last reported ${lastHeardText(bus.gpsAgeMin)}.`;
  }
  if (!TRUSTED_STATES.includes(bus.state)) return 'This bus is not in service.';
  if (nearestKm(located, position) > longestGapKm(located)) {
    return 'This bus is away from this route.';
  }
  return null;
}

/**
 * The next stop, claiming a position only when it can be trusted: a fix within
 * the reporting window, on a bus in service or on the road, and no farther from
 * the nearest located stop than the longest gap between consecutive located
 * stops (beyond that the bus is not on this route). When the rule fails the
 * timetable answers if it can; otherwise there is no next stop and a sentence
 * says why.
 */
export function resolveNextStop(
  stops: readonly CanonicalStop[],
  bus: NextStopBus,
  timeOfDay: string | null,
): NextStopResolution {
  const ordered = [...stops].sort((a, b) => a.sequence - b.sequence);
  const located = fittingStops(ordered.filter(isLocated));
  const { position } = bus;
  let reason: string | null = null;
  if (isUsablePosition(position) && located.length >= MIN_LOCATED_STOPS) {
    reason = positionDistrust(bus, located, position);
    if (reason === null) {
      const stop = byPosition(located, position);
      return stop
        ? { next: { stop, method: 'position' }, reason: null }
        : { next: null, reason: 'This bus has passed the last stop.' };
    }
  }
  const stop = bySchedule(ordered, timeOfDay);
  if (stop) return { next: { stop, method: 'schedule' }, reason };
  return { next: null, reason: reason ?? 'No stop is scheduled later than the feed time.' };
}
