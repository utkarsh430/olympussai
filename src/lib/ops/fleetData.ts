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
import liveFixture from '@/fixtures/upsrtc-live-sample.json';
import scheduleFixture from '@/fixtures/upsrtc-schedule-sample.json';
import type { CanonicalLiveBus, CanonicalSchedule, UpstreamSource } from '@/models/canonical';

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
 * Real live fleet/vehicle status data for the dispatcher, control-room,
 * depot and planner dashboards. Never throws and never returns a value that
 * would leave a dashboard blank — same fallback ladder as
 * src/app/api/upsrtc/live/route.ts (fresh -> last-known-good cache (stale)
 * -> bundled fixture), just returned as data instead of an HTTP response.
 */
export async function getOpsFleetSnapshot(now: number = Date.now()): Promise<OpsFleetSnapshot> {
  try {
    if (process.env.NEXT_PUBLIC_DEMO_MODE === '1') {
      return fixtureSnapshot('Fixture mode forced via NEXT_PUBLIC_DEMO_MODE');
    }

    const cached = liveCache.get(LIVE_CACHE_KEY, now);
    if (cached) return { ...cached, source: 'cache', stale: false };

    const result = await fetchUpstream(UPSRTC_LIVE_URL, REQUEST_TIMEOUT_MS);
    if (result.ok) {
      const { buses } = normalizeLivePayload(result.payload, now);
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
    }

    const error = result.ok ? 'Upstream responded but contained no usable bus records' : (result.error ?? 'Unknown upstream failure');
    const lastGood = liveCache.getLastGood(LIVE_CACHE_KEY);
    if (lastGood) {
      return { ...lastGood.value, source: 'cache', stale: true, error };
    }
    return fixtureSnapshot(error);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Unknown error fetching live fleet data';
    return fixtureSnapshot(message);
  }
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

function candidateDates(requested: string, today: string): string[] {
  return [...new Set([requested, today, shiftDate(today, -1), shiftDate(today, -2)])];
}

/**
 * Real schedule/roster data for one vehicle, used by the depot, planner and
 * driver dashboards. `regNum` is validated by the caller (route handler) —
 * this function assumes it is already a plausible registration number.
 * Never throws; same fallback ladder as getOpsFleetSnapshot.
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

    if (process.env.NEXT_PUBLIC_DEMO_MODE === '1') {
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

    const lastGood = scheduleCache.getLastGood(cacheKey);
    if (lastGood) return { ...lastGood.value, source: 'cache', stale: true, error: lastError };
    return fixtureSchedule(normalizedReg, date, lastError);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Unknown error fetching vehicle schedule';
    return fixtureSchedule(regNum.toUpperCase(), requestedDate ?? indiaDate(), message);
  }
}
