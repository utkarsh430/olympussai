/**
 * Server-only real-data source for the ops role dashboards.
 *
 * There is no REST client from this app to the persistent control service
 * yet (docs/CONTROL_SERVICE_INTEGRATION.md — building one is its own,
 * separate, pre-merge-gated piece of work: service-token auth, circuit
 * breaker, failure-isolation tests, security review). This ticket is about
 * making the five /ops/<role> pages show real operational data now, so it
 * reuses the upstream feed this app already integrates live in production
 * for the exact same purpose (src/lib/upsrtc/client.ts, used by
 * /project/upsrtc and /api/upsrtc/*): real vehicle GPS/status and schedule
 * data from the UPSRTC upstream, normalized into the same canonical shapes
 * (src/models/canonical.ts) already relied on elsewhere in this app.
 *
 * This intentionally does not call the /api/upsrtc/* route handlers over
 * HTTP — those are gated by the separate Supabase Auth session
 * (requireUpsrtcAccess in src/lib/auth/authorize.ts), which an ops RBAC user
 * never holds: the two auth systems are deliberately disjoint. Instead this
 * module calls the same underlying fetch/normalize/cache building blocks
 * directly, in-process, guarded by the caller's own ops RBAC session
 * instead. (That gate used to be an env-var PIN system; it is Supabase now,
 * but it is still not a credential an ops account carries.)
 */
import 'server-only';
import { fetchUpstream, UPSRTC_LIVE_URL, REQUEST_TIMEOUT_MS, buildScheduleUrl, indiaDate, shiftDate, isValidRegistrationNumber } from '@/lib/upsrtc/client';
import { normalizeLivePayload, normalizeSchedulePayload } from '@/lib/upsrtc/normalizer';
import { TtlCache } from '@/lib/upsrtc/cache';
import { isDemoModeForced, isFixtureFallbackAllowed } from '@/lib/upsrtc/fixtureFallback';
import liveFixture from '@/fixtures/upsrtc-live-sample.json';
import scheduleFixture from '@/fixtures/upsrtc-schedule-sample.json';
import type { CanonicalLiveBus, CanonicalSchedule, UpstreamSource } from '@/models/canonical';
import { filterBusesToScope, type OpsFleetScope } from './depotScope';

const LIVE_CACHE_TTL_MS = 15_000;
const SCHEDULE_CACHE_TTL_MS = 120_000;
// Mirrors src/app/api/upsrtc/schedule/route.ts's SCHEDULE_TIMEOUT_MS: the
// upstream schedule lookup is far slower than the live feed (~8s for a real
// 145-stop schedule), so the timeout has to clear that case.
const SCHEDULE_TIMEOUT_MS = 15_000;

// Separate module-scoped caches from the /api/upsrtc/* route handlers'
// caches (src/app/api/upsrtc/live/route.ts, .../schedule/route.ts) — this
// module is a distinct call path with its own warm-process lifetime, and
// sharing a cache instance across two independent auth surfaces would be a
// needless coupling.
const liveCache = new TtlCache<OpsFleetSnapshot>(LIVE_CACHE_TTL_MS);
const LIVE_CACHE_KEY = 'ops-fleet-live';
const scheduleCache = new TtlCache<OpsVehicleScheduleResult>(SCHEDULE_CACHE_TTL_MS);

export interface OpsFleetSnapshot {
  buses: CanonicalLiveBus[];
  source: UpstreamSource;
  stale: boolean;
  fetchedAt: string;
  /** Non-null whenever the live upstream call itself failed, even if a cached/fixture value is still shown. */
  error: string | null;
  /**
   * Provenance detail for the honest states: why the feed is unavailable, or
   * that a successful upstream response genuinely listed no vehicles. Never
   * set on an ordinary fresh 'live'/'cache' snapshot.
   */
  message?: string;
}

function fixtureSnapshot(reason: string): OpsFleetSnapshot {
  try {
    const { buses } = normalizeLivePayload(liveFixture);
    return { buses, source: 'fixture', stale: true, fetchedAt: new Date().toISOString(), error: reason };
  } catch (cause) {
    // Defensive: even the bundled fixture must never throw out of this
    // function — an ops dashboard has to render *something* (AC: "fails
    // gracefully ... without breaking the page guard or navigation").
    const message = cause instanceof Error ? cause.message : 'Unknown fixture error';
    return { buses: [], source: 'fixture', stale: true, fetchedAt: new Date().toISOString(), error: `${reason}; fixture fallback also failed: ${message}` };
  }
}

/**
 * The honest answer when the upstream could not be reached and no real cached
 * response exists: zero rows and an explicit 'unavailable' source, so a
 * dispatcher's fleet table is empty and loudly flagged rather than quietly
 * populated with buses that do not exist.
 *
 * Distinct on purpose from `liveEmptySnapshot` below: "we could not reach the
 * upstream" is an incident; "the upstream answered and listed no vehicles" is
 * a quiet night. Both show zero rows, so the source is what tells them apart.
 */
function unavailableSnapshot(reason: string, now: number): OpsFleetSnapshot {
  return {
    buses: [],
    source: 'unavailable',
    // Nothing fresh is being shown, so no consumer should treat this as
    // current data — even though (unlike a stale cache) there is no older
    // real data behind it either.
    stale: true,
    fetchedAt: new Date(now).toISOString(),
    error: reason,
    message: `Live fleet data is unavailable — the UPSRTC upstream did not answer and no cached response is held. (${reason})`,
  };
}

/** A successful upstream response that listed no vehicles at all. Real data, just empty. */
function liveEmptySnapshot(now: number): OpsFleetSnapshot {
  return {
    buses: [],
    source: 'live',
    stale: false,
    fetchedAt: new Date(now).toISOString(),
    error: null,
    message: 'The UPSRTC upstream answered normally and reported no vehicles on the road.',
  };
}

/**
 * Fixture substitution, but only where it has been explicitly permitted.
 * Otherwise the caller gets the explicit unavailable state.
 */
function degradedSnapshot(reason: string, now: number): OpsFleetSnapshot {
  return isFixtureFallbackAllowed() ? fixtureSnapshot(reason) : unavailableSnapshot(reason, now);
}

/**
 * Real live fleet/vehicle status data for the dispatcher, control-room,
 * depot and planner dashboards. Never throws and never breaks a page — same
 * fallback ladder as src/app/api/upsrtc/live/route.ts, returned as data
 * instead of an HTTP response:
 *
 *   fresh live -> last-known-good cache (real data, flagged stale)
 *              -> explicit 'unavailable' (zero rows)
 *
 * The bundled fixture is only ever inserted into that ladder when it has been
 * asked for — see src/lib/upsrtc/fixtureFallback.ts. It used to be automatic,
 * which meant an upstream outage silently filled a dispatcher's table with
 * demo buses.
 *
 * STATEWIDE, AND NOT EXPORTED. Every caller goes through getOpsFleetSnapshot
 * below and states a scope. This function exists separately because the cache
 * underneath it is shared process-wide under one key: a depot filter applied
 * BEFORE the cache write would store one depot's fleet under the key every
 * other caller reads, handing depot A's snapshot to depot B for the next 15
 * seconds. Fetch and cache statewide; narrow on the way out.
 */
async function getStatewideFleetSnapshot(now: number = Date.now()): Promise<OpsFleetSnapshot> {
  try {
    if (isDemoModeForced()) {
      return fixtureSnapshot('Fixture mode forced via NEXT_PUBLIC_DEMO_MODE');
    }

    const cached = liveCache.get(LIVE_CACHE_KEY, now);
    if (cached) return { ...cached, source: 'cache', stale: false };

    const result = await fetchUpstream(UPSRTC_LIVE_URL, REQUEST_TIMEOUT_MS);
    if (result.ok) {
      const { buses, recordCount } = normalizeLivePayload(result.payload, now);
      if (buses.length > 0) {
        const snapshot: OpsFleetSnapshot = {
          buses,
          source: 'live',
          stale: false,
          fetchedAt: new Date(now).toISOString(),
          error: null,
        };
        liveCache.set(LIVE_CACHE_KEY, snapshot, now);
        return snapshot;
      }

      // The upstream answered and carried nothing at all: a real, healthy
      // "no vehicles on the road" reading, not a failure. Deliberately not
      // cached — an empty fleet is cheap to re-ask for, and caching it would
      // let a quiet minute mask the next real fetch's last-known-good.
      if (recordCount === 0) return liveEmptySnapshot(now);
      // Records arrived but every one was rejected as unusable: the feed is
      // answering with data we cannot trust, which is a degradation.
    }

    const error = result.ok ? 'Upstream responded but contained no usable bus records' : (result.error ?? 'Unknown upstream failure');
    const lastGood = liveCache.getLastGood(LIVE_CACHE_KEY);
    if (lastGood) {
      // Real data that was really observed, only older than it looks —
      // legitimate degradation, never gated behind the fixture flag.
      return { ...lastGood.value, source: 'cache', stale: true, error };
    }
    return degradedSnapshot(error, now);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Unknown error fetching live fleet data';
    return degradedSnapshot(message, now);
  }
}

/**
 * Real live fleet data, narrowed to what the caller is allowed to see.
 *
 * `scope` is REQUIRED and has no default. That is the point: an omitted
 * argument used to mean "the entire statewide fleet", which is how every
 * depot operator came to see all ~9,000 vehicles in the state. There is now
 * no way to call this without saying who it is for, so a new dashboard cannot
 * inherit the statewide fleet by accident — it has to ask for
 * OPS_FLEET_SCOPE_ALL explicitly, and that is reviewable.
 *
 * Resolve the scope with resolveOpsFleetScope (src/lib/ops/depotAccess.ts),
 * which derives it from the caller's own ops_users row. Never build a depot
 * scope from anything in the request.
 *
 * The narrowing is applied server-side, here, before the data ever reaches a
 * component — the vehicles a depot operator is not entitled to are not
 * hidden in the browser, they are never sent. `buses.length` and every
 * count derived from it are the scoped numbers, so a roster header cannot
 * quietly report a statewide total over a scoped list.
 */
export async function getOpsFleetSnapshot(
  scope: OpsFleetScope,
  now: number = Date.now(),
): Promise<OpsFleetSnapshot> {
  const snapshot = await getStatewideFleetSnapshot(now);
  if (scope.kind === 'all') return snapshot;
  // Rebuilt rather than mutated: the object above may be the cache's own
  // retained value (the `source: 'cache'` branches spread a stored snapshot),
  // and narrowing that in place would poison the shared cache entry.
  return { ...snapshot, buses: filterBusesToScope(snapshot.buses, scope) };
}

export interface OpsVehicleScheduleResult {
  schedule: CanonicalSchedule | null;
  source: UpstreamSource;
  stale: boolean;
  error: string | null;
  message?: string;
}

function fixtureSchedule(regNum: string, date: string, reason: string): OpsVehicleScheduleResult {
  try {
    const schedule = normalizeSchedulePayload(scheduleFixture, regNum, date);
    return { schedule, source: 'fixture', stale: true, error: reason };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Unknown fixture error';
    return { schedule: null, source: 'fixture', stale: true, error: `${reason}; fixture fallback also failed: ${message}` };
  }
}

/**
 * The honest answer for a schedule lookup the upstream could not serve: no
 * schedule, explicitly flagged unavailable.
 *
 * Distinct from the `source: 'live', schedule: null` result below, which
 * means the upstream answered for every candidate date and this vehicle
 * genuinely has no assignment. Both show "no schedule"; only the source says
 * whether that is a fact about the roster or a fact about the network.
 */
function unavailableSchedule(reason: string): OpsVehicleScheduleResult {
  return {
    schedule: null,
    source: 'unavailable',
    stale: true,
    error: reason,
    message: `Live schedule data is unavailable — the UPSRTC upstream did not answer and no cached schedule is held. (${reason})`,
  };
}

/** Fixture substitution for a schedule, but only where explicitly permitted. */
function degradedSchedule(regNum: string, date: string, reason: string): OpsVehicleScheduleResult {
  return isFixtureFallbackAllowed() ? fixtureSchedule(regNum, date, reason) : unavailableSchedule(reason);
}

function candidateDates(requested: string, today: string): string[] {
  return [...new Set([requested, today, shiftDate(today, -1), shiftDate(today, -2)])];
}

/**
 * Real schedule/roster data for one vehicle, used by the depot, planner and
 * driver dashboards. `regNum` is validated by the caller (route handler) —
 * this function assumes it is already a plausible registration number.
 * Never throws; same fallback ladder as getOpsFleetSnapshot, including the
 * fixture step being opt-in rather than automatic.
 */
export async function getOpsVehicleSchedule(
  regNum: string,
  requestedDate?: string,
  tripId?: string | null,
): Promise<OpsVehicleScheduleResult> {
  try {
    if (!isValidRegistrationNumber(regNum)) {
      return { schedule: null, source: 'live', stale: false, error: 'Malformed registration number.' };
    }

    const normalizedReg = regNum.toUpperCase();
    const today = indiaDate();
    const date = requestedDate ?? today;
    const cacheKey = `${normalizedReg}:${date}:${tripId ?? '-'}`;
    const now = Date.now();

    const cached = scheduleCache.get(cacheKey, now);
    if (cached) return { ...cached, source: 'cache', stale: false };

    if (isDemoModeForced()) {
      return fixtureSchedule(normalizedReg, date, 'Fixture mode forced via NEXT_PUBLIC_DEMO_MODE');
    }

    const dates = candidateDates(date, today);
    let lastError: string | null = null;

    for (const candidate of dates) {
      const result = await fetchUpstream(buildScheduleUrl(normalizedReg, candidate), SCHEDULE_TIMEOUT_MS);
      if (!result.ok) {
        lastError = result.error ?? 'Unknown upstream failure';
        continue;
      }
      const schedule = normalizeSchedulePayload(result.payload, normalizedReg, candidate, tripId);
      if (schedule) {
        const value: OpsVehicleScheduleResult = { schedule, source: 'live', stale: false, error: null };
        scheduleCache.set(cacheKey, value, now);
        return value;
      }
    }

    // Every candidate date answered but none had an assignment: a genuine
    // "not assigned" result, worth caching so repeated lookups don't re-fan
    // out across dates.
    if (lastError === null) {
      const value: OpsVehicleScheduleResult = {
        schedule: null,
        source: 'live',
        stale: false,
        error: null,
        message: `No schedule assigned to ${normalizedReg} (checked ${date} and the preceding operating days).`,
      };
      scheduleCache.set(cacheKey, value, now);
      return value;
    }

    // A previously-fetched real schedule, served after a failed refresh:
    // legitimate degradation, never gated behind the fixture flag.
    const lastGood = scheduleCache.getLastGood(cacheKey);
    if (lastGood) return { ...lastGood.value, source: 'cache', stale: true, error: lastError };
    return degradedSchedule(normalizedReg, date, lastError);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Unknown error fetching vehicle schedule';
    return degradedSchedule(regNum.toUpperCase(), requestedDate ?? indiaDate(), message);
  }
}
