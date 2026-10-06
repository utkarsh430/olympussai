import { fetchBusSchedule } from '@/lib/upsrtc/scheduleService';
import type { RateDecision } from '../rateLimit';
import { isValidRouteName } from '../ids';
import { logDepotError } from '@/lib/serverLog';
import { classifyBusState, gpsAgeMinutes } from '../infer/busState';
import type { FleetSnapshotView } from '../repositories/types';
import type { DepotBusRow } from '@/models/depotLive';
import { operatingDateOf } from '../sim/seed';
import { buildRouteProfile } from './routeProfile';
import type { RouteProfile, RouteProfileResult, RouteStop } from './types';

/**
 * On-demand route catalogue. A route is read through one bus that is running
 * it, one lookup per route per operating day, and never crawled: the upstream
 * is a government server and the fleet has thousands of routes. One lookup is
 * up to `SCHEDULE_MAX_UPSTREAM_CALLS` calls to that server (the bus's date,
 * then the fallback dates). The caller's permit is asked before each call, so a
 * lookup is charged the calls it makes; a refused call stops it as `limited`.
 */

export const ROUTE_CACHE_MAX = 2000;
export const ROUTE_NEGATIVE_TTL_MS = 600_000;

/**
 * How long the route-details route waits for the snapshot and the lookup together
 * before it answers its own fixed error. The snapshot can take 10 s and the
 * lookup's two rounds of schedule calls 15 s each, which is longer than the 30 s
 * the platform allows the route; past that limit the platform answers with its own
 * error body and caching. A lookup cut off here still runs to its end, and an
 * answer it gets is cached for the next request.
 */
export const ROUTE_LOOKUP_DEADLINE_MS = 25_000;

type Unavailable = Extract<RouteProfileResult, { status: 'unavailable' }>;

/**
 * Asked immediately before each call to the schedule server; the call is made only
 * when it is not limited. It must take its slot in the same step as it decides, so
 * lookups in flight together can never pass the limit between them.
 */
export type UpstreamPermit = () => RateDecision;

/** A call the lookup needed was refused: no answer, nothing remembered, try after the wait. */
export interface LimitedLookup {
  readonly status: 'limited';
  readonly retryAfterSeconds: number;
}

export type RouteLookupOutcome = RouteProfileResult | LimitedLookup;

interface NegativeEntry {
  readonly result: Unavailable;
  readonly storedAt: number;
}

const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;

// Insertion order is the age, so the first key is always the oldest.
const profiles = new Map<string, RouteProfile>();
const negatives = new Map<string, NegativeEntry>();
const inFlight = new Map<string, Promise<RouteLookupOutcome>>();
/** Bumped whenever the set of cached profiles changes, so views built on it know to rebuild. */
let revision = 0;

function setBounded<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key);
  if (map.size >= ROUTE_CACHE_MAX) {
    const oldest = map.keys().next();
    if (!oldest.done) map.delete(oldest.value);
  }
  map.set(key, value);
}

const normaliseName = (name: string): string => name.trim().toUpperCase();

const unavailable =(reason: Unavailable['reason']): Unavailable => ({
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

/**
 * The bus's own scheduled date, else the date the views derive from the feed's
 * clock. Never the wall clock: the fetch and the cached lookup must agree on
 * the key whatever time it is when each runs.
 */
function operatingDate(row: DepotBusRow, feedDate: string): string {
  return row.scheduledStart?.match(DATE_PREFIX)?.[0] ?? feedDate;
}

/** Frozen on the way into the cache, so no consumer can poison a shared profile. */
function frozenProfile(profile: RouteProfile): RouteProfile {
  const freezeStop = (stop: RouteStop | null): RouteStop | null =>
    stop === null ? null : Object.freeze({ ...stop });
  return Object.freeze({
    ...profile,
    origin: freezeStop(profile.origin),
    destination: freezeStop(profile.destination),
    stops: Object.freeze(profile.stops.map((stop) => Object.freeze({ ...stop }))),
  });
}

interface Lookup {
  readonly bus: DepotBusRow;
  /** The date the upstream is asked for: the bus's own scheduled date when it has one. */
  readonly date: string;
  /** The operating date from the feed's clock. */
  readonly feedDate: string;
  readonly key: string;
}

async function fetchProfile(
  routeName: string,
  { bus, date, feedDate }: Lookup,
  now: number,
  permit: UpstreamPermit | undefined,
): Promise<RouteLookupOutcome> {
  // The service is told only yes or no; the wait of a refusal is kept here for the answer.
  const refusal: { decision: RateDecision | null } = { decision: null };
  const asking =
    permit === undefined
      ? {}
      : {
          beforeUpstreamCall: (): boolean => {
            const decision = permit();
            if (decision.limited) refusal.decision = decision;
            return !decision.limited;
          },
        };
  try {
    // The service's fallback dates count back from the feed's date, not the wall clock.
    // Strict: "no schedule" is cached for ten minutes, so it must be what the server
    // said for every date tried, never a date that failed to answer.
    const response = await fetchBusSchedule(
      { regNum: bus.registrationNumber, date, tripId: bus.journeyId },
      now,
      { today: feedDate, requireEveryDateAnswered: true, ...asking },
    );
    // The fixture is a stand-in, not this route: never present it as real data.
    if (response.source === 'fixture') return unavailable('upstream_error');
    if (!response.schedule) return unavailable('no_schedule');
    const { schedule } = response;
    // No stops is no route to profile. Held as a ten-minute negative, so the route
    // reads as not profiled and is asked about again, never as profiled for the day.
    if (schedule.stops.length === 0) return unavailable('no_schedule');
    // A bus reassigned since the snapshot, or a trip id that fell back to the
    // day's earliest trip, returns another route's stops. Never catalogue those.
    // Compared without regard to case or padding: the upstream does not format
    // a route name identically across its two APIs.
    const sameName =
      schedule.routeName !== null && normaliseName(schedule.routeName) === normaliseName(routeName);
    if (schedule.routeName !== null && !sameName) {
      return unavailable('no_schedule');
    }
    const routeNameConfirmed = sameName;
    if (!routeNameConfirmed && bus.journeyId !== null && schedule.tripId !== bus.journeyId) {
      return unavailable('no_schedule');
    }
    const built = buildRouteProfile(schedule, bus.registrationNumber, date);
    return {
      status: 'ok',
      profile: { ...built, routeNameConfirmed, description: bus.routeDescription },
    };
  } catch (error) {
    // A refused call is the limit at work, not a failure: the person is told to wait.
    const { decision } = refusal;
    if (decision !== null) {
      return { status: 'limited', retryAfterSeconds: decision.retryAfterSeconds };
    }
    logDepotError('route-catalogue', error);
    return unavailable('upstream_error');
  }
}

/** The bus a profile is fetched for and its cache key, or null when no bus runs the route. */
function lookupFor(routeName: string, view: FleetSnapshotView): Lookup | null {
  if (!isValidRouteName(routeName)) return null;
  const bus = view.rows
    .filter((row) => row.routeName === routeName)
    .sort(compareCandidates(view.feedNow))[0];
  if (!bus) return null;
  // The operating date comes from the feed's clock, never the wall clock.
  const feedDate = operatingDateOf(view.feedNow, view.fetchedAt);
  const date = operatingDate(bus, feedDate);
  return { bus, date, feedDate, key: profileKey(routeName, feedDate) };
}

/**
 * A profile is held for the route and the feed's operating date, not the date of
 * the bus it was read through: when another bus with another scheduled date (an
 * overnight service) ranks first later the same day, the profile is still found.
 */
const profileKey = (routeName: string, feedDate: string): string => `${routeName}:${feedDate}`;

const freshNegative = (routeName: string, now: number): NegativeEntry | undefined => {
  const negative = negatives.get(routeName);
  return negative && now - negative.storedAt < ROUTE_NEGATIVE_TTL_MS ? negative : undefined;
};

/**
 * The route's profile, from the cache or through one lookup. `permit`, when given,
 * is asked before each call to the schedule server; a cache hit, a fresh negative
 * answer or joining a lookup already in flight asks nothing. A request that joins a
 * lookup gets that lookup's outcome, `limited` included.
 */
export async function getRouteProfile(
  routeName: string,
  view: FleetSnapshotView,
  now: number = Date.now(),
  permit?: UpstreamPermit,
): Promise<RouteLookupOutcome> {
  const lookup = lookupFor(routeName, view);
  if (!lookup) return unavailable('no_bus_on_route');
  const { key } = lookup;

  const known = profiles.get(key);
  if (known) return { status: 'ok', profile: known };

  const negative = freshNegative(routeName, now);
  if (negative) return negative.result;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = fetchProfile(routeName, lookup, now, permit)
    .then((result): RouteLookupOutcome => {
      // A stopped lookup has no answer: nothing is remembered.
      if (result.status === 'limited') return result;
      if (result.status !== 'ok') {
        // Only an answer is remembered. A failure is not: the person's Retry must
        // reach the server again, and every such retry is charged to the limiter.
        if (result.reason !== 'upstream_error') {
          setBounded(negatives, routeName, { result, storedAt: now });
        }
        return result;
      }
      const profile = frozenProfile(result.profile);
      setBounded(profiles, key, profile);
      revision += 1;
      negatives.delete(routeName);
      return { status: 'ok', profile };
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

/**
 * Profiles already cached for the routes in this snapshot, under the same key
 * `getRouteProfile` uses (the route and the feed's operating date) but never
 * fetched: a view over many routes must not turn into a crawl of the upstream.
 * Routes absent from the result have not been profiled today. `feedDate` is
 * the operating date the view derived from the feed's clock.
 */
export function cachedRouteProfiles(
  view: FleetSnapshotView,
  feedDate: string,
): ReadonlyMap<string, RouteProfile> {
  const found = new Map<string, RouteProfile>();
  for (const row of view.rows) {
    if (!isValidRouteName(row.routeName) || found.has(row.routeName)) continue;
    const profile = profiles.get(profileKey(row.routeName, feedDate));
    if (profile) found.set(row.routeName, profile);
  }
  return found;
}

/** Changes whenever a profile is added to the cache (or the cache is reset). */
export function routeCatalogueRevision(): number {
  return revision;
}

export function resetRouteCatalogueForTests(): void {
  revision += 1;
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
