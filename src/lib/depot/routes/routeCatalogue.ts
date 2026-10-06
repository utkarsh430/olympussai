import { indiaDate } from '@/lib/upsrtc/client';
import { fetchBusSchedule } from '@/lib/upsrtc/scheduleService';
import { isValidRouteName } from '../ids';
import { logDepotError } from '../log';
import { classifyBusState, gpsAgeMinutes } from '../infer/busState';
import type { FleetSnapshotView } from '../repositories/types';
import type { DepotBusRow } from '@/models/depotLive';
import { buildRouteProfile } from './routeProfile';
import type { RouteProfile, RouteProfileResult } from './types';

/**
 * On-demand route catalogue. A route is read through one bus that is running
 * it, one upstream request per route per operating day, and never crawled: the
 * upstream is a government server and the fleet has thousands of routes.
 */

export const ROUTE_CACHE_MAX = 2000;
export const ROUTE_NEGATIVE_TTL_MS = 600_000;

type Unavailable = Extract<RouteProfileResult, { status: 'unavailable' }>;

interface NegativeEntry {
  readonly result: Unavailable;
  readonly storedAt: number;
}

const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;

// Insertion order is the age, so the first key is always the oldest.
const profiles = new Map<string, RouteProfile>();
const negatives = new Map<string, NegativeEntry>();
const inFlight = new Map<string, Promise<RouteProfileResult>>();

function setBounded<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key);
  if (map.size >= ROUTE_CACHE_MAX) {
    const oldest = map.keys().next();
    if (!oldest.done) map.delete(oldest.value);
  }
  map.set(key, value);
}

const unavailable = (reason: Unavailable['reason']): Unavailable => ({
  status: 'unavailable',
  reason,
});

/** In service first, then freshest GPS fix (none last), then registration. */
function compareCandidates(
  feedNow: string | null,
): (a: DepotBusRow, b: DepotBusRow) => number {
  const rank = (row: DepotBusRow): [number, number, string] => [
    classifyBusState(row, feedNow) === 'in_service' ? 0 : 1,
    gpsAgeMinutes(row, feedNow) ?? Number.POSITIVE_INFINITY,
    row.registrationNumber,
  ];
  return (a, b) => {
    const [stateA, ageA, regA] = rank(a);
    const [stateB, ageB, regB] = rank(b);
    if (stateA !== stateB) return stateA - stateB;
    if (ageA !== ageB) return ageA < ageB ? -1 : 1;
    return regA < regB ? -1 : regA > regB ? 1 : 0;
  };
}

function operatingDate(row: DepotBusRow, view: FleetSnapshotView, now: number): string {
  const fromStart = row.scheduledStart?.match(DATE_PREFIX)?.[0];
  if (fromStart) return fromStart;
  const fromFeed = view.feedNow?.match(DATE_PREFIX)?.[0];
  return fromFeed ?? indiaDate(new Date(now));
}

async function fetchProfile(
  routeName: string,
  bus: DepotBusRow,
  date: string,
  now: number,
): Promise<RouteProfileResult> {
  try {
    const response = await fetchBusSchedule(
      { regNum: bus.registrationNumber, date, tripId: bus.journeyId },
      now,
    );
    // The fixture is a stand-in, not this route: never present it as real data.
    if (response.source === 'fixture') return unavailable('upstream_error');
    if (!response.schedule) return unavailable('no_schedule');
    const { schedule } = response;
    // A bus reassigned since the snapshot, or a trip id that fell back to the
    // day's earliest trip, returns another route's stops. Never catalogue those.
    if (schedule.routeName !== null && schedule.routeName !== routeName) {
      return unavailable('no_schedule');
    }
    const routeNameConfirmed = schedule.routeName === routeName;
    if (!routeNameConfirmed && bus.journeyId !== null && schedule.tripId !== bus.journeyId) {
      return unavailable('no_schedule');
    }
    const built = buildRouteProfile(schedule, bus.registrationNumber, date);
    return {
      status: 'ok',
      profile: { ...built, routeNameConfirmed, description: bus.routeDescription },
    };
  } catch (error) {
    logDepotError('route-catalogue', error);
    return unavailable('upstream_error');
  }
}

export async function getRouteProfile(
  routeName: string,
  view: FleetSnapshotView,
  now: number = Date.now(),
): Promise<RouteProfileResult> {
  if (!isValidRouteName(routeName)) return unavailable('no_bus_on_route');

  const bus = view.rows
    .filter((row) => row.routeName === routeName)
    .sort(compareCandidates(view.feedNow))[0];
  if (!bus) return unavailable('no_bus_on_route');

  const date = operatingDate(bus, view, now);
  const key = `${routeName}:${date}`;

  const known = profiles.get(key);
  if (known) return { status: 'ok', profile: known };

  const negative = negatives.get(routeName);
  if (negative && now - negative.storedAt < ROUTE_NEGATIVE_TTL_MS) return negative.result;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = fetchProfile(routeName, bus, date, now)
    .then((result) => {
      if (result.status === 'ok') {
        setBounded(profiles, key, result.profile);
        negatives.delete(routeName);
      } else {
        setBounded(negatives, routeName, { result, storedAt: now });
      }
      return result;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

export function resetRouteCatalogueForTests(): void {
  profiles.clear();
  negatives.clear();
  inFlight.clear();
}

export function inFlightSizeForTests(): number {
  return inFlight.size;
}

export function routeCacheSizeForTests(): number {
  return profiles.size;
}
