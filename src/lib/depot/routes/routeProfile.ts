import { haversineKm } from '../infer/geo';
import type { CanonicalSchedule, CanonicalStop } from '@/models/canonical';
import type { RouteProfile, RouteStop } from './types';
import { MINUTES_PER_DAY } from '@/lib/depot/units';
import { judgedTime, parseWallClockMinutes, positionsFitTimetable } from './timetableFit';

type LocatedStop = RouteStop & { readonly lat: number; readonly lng: number };

function toRouteStop(stop: Readonly<CanonicalStop>): RouteStop {
  const located = stop.latitude !== null && stop.longitude !== null;
  return {
    name: stop.name,
    sequence: stop.sequence,
    lat: located ? stop.latitude : null,
    lng: located ? stop.longitude : null,
    scheduled: judgedTime(stop),
  };
}

const isLocated = (stop: RouteStop): stop is LocatedStop =>
  stop.lat !== null && stop.lng !== null;

/** Last minus first scheduled time; a negative gap is an overnight run. */
function durationMin(first: RouteStop | null, last: RouteStop | null): number | null {
  const start = parseWallClockMinutes(first?.scheduled ?? null);
  const end = parseWallClockMinutes(last?.scheduled ?? null);
  if (start === null || end === null) return null;
  const gap = end - start;
  return Math.round(gap < 0 ? gap + MINUTES_PER_DAY : gap);
}

interface FittedStops {
  readonly stops: readonly RouteStop[];
  readonly mislocated: number;
}

/**
 * The stops with every position that does not fit the timetable dropped, so the
 * length, the terminals and every reader of a stop's position see one located set.
 */
function withFittingPositions(stops: readonly RouteStop[]): FittedStops {
  const located = stops.filter(isLocated);
  const fits = positionsFitTimetable(located);
  const misfits = new Set<RouteStop>(located.filter((_, index) => !fits[index]));
  return {
    stops: stops.map((stop) => (misfits.has(stop) ? { ...stop, lat: null, lng: null } : stop)),
    mislocated: misfits.size,
  };
}

function straightLineLengthKm(stops: readonly RouteStop[]): number | null {
  const located = stops.filter(isLocated);
  if (located.length < 2) return null;
  let total = 0;
  located.forEach((to, index) => {
    const from = located[index - 1];
    if (from) total += haversineKm(from.lat, from.lng, to.lat, to.lng);
  });
  return Number.isFinite(total) ? Math.round(total * 10) / 10 : null;
}

/**
 * Pure: derives a route profile from one bus's schedule. Stops with no usable
 * position, or with a position that does not fit the timetable, stay in the list
 * (they are real stops) but are skipped for length and terminals, so neither a
 * `0,0` placeholder nor a same-named place elsewhere can inflate the distance.
 */
export function buildRouteProfile(
  schedule: Readonly<CanonicalSchedule>,
  sampledFrom: string,
  operatingDate: string,
): RouteProfile {
  const given = [...schedule.stops].sort((a, b) => a.sequence - b.sequence).map(toRouteStop);
  const { stops, mislocated } = withFittingPositions(given);
  const origin = stops[0] ?? null;
  const destination = stops[stops.length - 1] ?? null;
  return {
    routeName: schedule.routeName ?? '',
    // Pure builder cannot know the requested name; the catalogue confirms it.
    routeNameConfirmed: false,
    routeId: schedule.routeId,
    // The schedule carries no description; the catalogue fills it from the feed row.
    description: null,
    direction: schedule.direction,
    origin,
    destination,
    stops,
    unlocatedStops: given.filter((stop) => !isLocated(stop)).length,
    mislocatedStops: mislocated,
    scheduledDurationMin: durationMin(origin, destination),
    lengthKm: straightLineLengthKm(stops),
    sampledFrom,
    operatingDate,
  };
}
