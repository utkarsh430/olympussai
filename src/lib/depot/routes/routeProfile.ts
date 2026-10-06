import { haversineKm } from '@/lib/simulation/seededRandom';
import type { CanonicalSchedule, CanonicalStop } from '@/models/canonical';
import type { RouteProfile, RouteStop } from './types';

const MINUTES_PER_DAY = 24 * 60;
const TIME_PATTERN = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

type LocatedStop = RouteStop & { readonly lat: number; readonly lng: number };

function toRouteStop(stop: Readonly<CanonicalStop>): RouteStop {
  const located = stop.latitude !== null && stop.longitude !== null;
  return {
    name: stop.name,
    sequence: stop.sequence,
    lat: located ? stop.latitude : null,
    lng: located ? stop.longitude : null,
    scheduled: stop.scheduledDeparture ?? stop.scheduledArrival,
  };
}

const isLocated = (stop: RouteStop): stop is LocatedStop =>
  stop.lat !== null && stop.lng !== null;

/** Minutes after midnight for an `HH:MM:SS` wall-clock string, else null. */
function parseWallClockMinutes(value: string | null): number | null {
  if (value === null) return null;
  const match = TIME_PATTERN.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? 0);
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return hours * 60 + minutes + seconds / 60;
}

/** Last minus first scheduled time; a negative gap is an overnight run. */
function durationMin(first: RouteStop | null, last: RouteStop | null): number | null {
  const start = parseWallClockMinutes(first?.scheduled ?? null);
  const end = parseWallClockMinutes(last?.scheduled ?? null);
  if (start === null || end === null) return null;
  const gap = end - start;
  return Math.round(gap < 0 ? gap + MINUTES_PER_DAY : gap);
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
 * position stay in the list (they are real stops) but are skipped for length,
 * so a `0,0` placeholder can never inflate the distance.
 */
export function buildRouteProfile(
  schedule: Readonly<CanonicalSchedule>,
  sampledFrom: string,
  operatingDate: string,
): RouteProfile {
  const stops = [...schedule.stops].sort((a, b) => a.sequence - b.sequence).map(toRouteStop);
  const origin = stops[0] ?? null;
  const destination = stops[stops.length - 1] ?? null;
  return {
    routeName: schedule.routeName ?? '',
    routeId: schedule.routeId,
    // The schedule carries no description; the catalogue fills it from the feed row.
    description: null,
    direction: schedule.direction,
    origin,
    destination,
    stops,
    unlocatedStops: stops.filter((stop) => !isLocated(stop)).length,
    scheduledDurationMin: durationMin(origin, destination),
    lengthKm: straightLineLengthKm(stops),
    sampledFrom,
    operatingDate,
  };
}
