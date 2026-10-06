import {
  fetchUpstream,
  buildScheduleUrl,
  indiaDate,
  shiftDate,
} from '@/lib/upsrtc/client';
import { normalizeSchedulePayload } from '@/lib/upsrtc/normalizer';
import { TtlCache } from '@/lib/upsrtc/cache';
import scheduleFixture from '@/fixtures/upsrtc-schedule-sample.json';
import type { CanonicalSchedule, ScheduleResponse } from '@/models/canonical';

/**
 * The fetch, candidate-date, normalise, cache and fallback logic behind the
 * schedule endpoint, moved out of the route so the depot route catalogue reads
 * through the same cache and the same " Bus Not Assigned!!! " handling.
 */

const CACHE_TTL_MS = 120_000;

/**
 * Cached as a wrapper rather than a bare schedule so that "this vehicle has no
 * assignment" is itself cacheable — otherwise every unassigned bus re-runs the
 * full date fan-out below on each selection.
 */
interface ScheduleLookup {
  schedule: CanonicalSchedule | null;
  resolvedDate: string;
}

/**
 * Most lookups the cache holds. Its key includes a trip id the caller chooses,
 * and a real schedule is about 30 KB, so without a bound one user could grow it
 * for the life of the process. 500 is about 15 MB at most.
 */
export const SCHEDULE_CACHE_MAX_KEYS = 500;

const cache = new TtlCache<ScheduleLookup>(CACHE_TTL_MS, { maxKeys: SCHEDULE_CACHE_MAX_KEYS });

/**
 * This endpoint is far slower than the live feed and asymmetrically so: a
 * measured " Bus Not Assigned!!! " comes back in ~0.7s, while a real 145-stop
 * schedule takes ~8s to assemble. The timeout has to clear the slow case, or it
 * preferentially aborts exactly the responses that carry data.
 */
const SCHEDULE_TIMEOUT_MS = 15_000;

export const scheduleDiagnostics = {
  lastAttemptAt: null as string | null,
  lastSuccessAt: null as string | null,
  lastError: null as string | null,
  requestCount: 0,
};

export interface BusScheduleInput {
  /** Already validated by the caller. */
  readonly regNum: string;
  readonly date: string | null;
  readonly tripId: string | null;
}

export interface BusScheduleOptions {
  /**
   * The operating date the fallback dates count back from. A caller that reads the
   * feed passes the date from the feed's clock; without one it is the India date of
   * the `now` passed in, never the machine clock read here.
   */
  readonly today?: string;
}

/** `today` itself and the days before it that a lookup falls back to. */
const FALLBACK_DAY_OFFSETS = [0, -1, -2] as const;

/**
 * The most calls one lookup can make to the schedule server: the requested date,
 * then each fallback date. A limiter that protects that server charges this much
 * for every lookup it lets through.
 */
export const SCHEDULE_MAX_UPSTREAM_CALLS = 1 + FALLBACK_DAY_OFFSETS.length;

export async function fetchBusSchedule(
  input: BusScheduleInput,
  now: number = Date.now(),
  options: BusScheduleOptions = {},
): Promise<ScheduleResponse> {
  const regNum = input.regNum.toUpperCase();
  const today = options.today ?? indiaDate(new Date(now));
  const requestedDate = input.date ?? today;
  const tripId = input.tripId;
  // The trip id selects which journey is returned, so it belongs in the key.
  const cacheKey = `${regNum}:${requestedDate}:${tripId ?? '-'}`;

  scheduleDiagnostics.requestCount += 1;

  const cached = cache.get(cacheKey, now);
  if (cached) {
    return {
      schedule: cached.schedule,
      fetchedAt: new Date(now).toISOString(),
      source: 'cache' as const,
      stale: false,
      message: cached.schedule ? undefined : noAssignmentMessage(cached.resolvedDate),
    } satisfies ScheduleResponse;
  }

  if (process.env.NEXT_PUBLIC_DEMO_MODE === '1') {
    return fixtureSchedule(regNum, requestedDate, 'Fixture mode forced');
  }

  scheduleDiagnostics.lastAttemptAt = new Date(now).toISOString();
  const lookup = await resolveSchedule(regNum, requestedDate, today, tripId);

  if (lookup.found) {
    cache.set(cacheKey, lookup.found, now);
    scheduleDiagnostics.lastSuccessAt = new Date(now).toISOString();
    scheduleDiagnostics.lastError = null;

    return {
      schedule: lookup.found.schedule,
      fetchedAt: new Date(now).toISOString(),
      source: 'live' as const,
      stale: false,
      message: lookup.found.schedule ? undefined : noAssignmentMessage(lookup.found.resolvedDate),
    } satisfies ScheduleResponse;
  }

  scheduleDiagnostics.lastError = lookup.error ?? 'Unknown upstream failure';

  const lastGood = cache.getLastGood(cacheKey);
  if (lastGood?.value.schedule) {
    return {
      schedule: lastGood.value.schedule,
      fetchedAt: new Date(lastGood.storedAt).toISOString(),
      source: 'cache' as const,
      stale: true,
    } satisfies ScheduleResponse;
  }

  return fixtureSchedule(regNum, requestedDate, scheduleDiagnostics.lastError);
}

/**
 * Candidate operating dates, most likely first.
 *
 * The upstream keys schedules on the date the trip departed, not on the current
 * calendar date, and answers " Bus Not Assigned!!! " for every other date. A
 * long-distance service that left at 22:00 is therefore invisible to a "today"
 * query for the whole of its second day on the road. The client supplies the
 * vehicle's own scheduled_start_time date, and these fallbacks cover vehicles
 * whose live record carries no assignment at all.
 */
function candidateDates(requested: string, today: string): string[] {
  return [...new Set([requested, ...FALLBACK_DAY_OFFSETS.map((days) => shiftDate(today, days))])];
}

interface ResolveResult {
  found: ScheduleLookup | null;
  error: string | null;
}

async function probe(
  regNum: string,
  date: string,
  timeoutMs: number,
  tripId: string | null,
): Promise<ScheduleLookup | string> {
  const result = await fetchUpstream(buildScheduleUrl(regNum, date), timeoutMs);
  if (!result.ok) return result.error ?? 'Unknown upstream failure';
  return {
    schedule: normalizeSchedulePayload(result.payload, regNum, date, tripId),
    resolvedDate: date,
  };
}

/**
 * Try the requested date, then fan out across the remaining candidates.
 *
 * The fan-out runs concurrently — sequential probes would stack four timeouts
 * onto a single click — but the winner is still chosen by candidate priority,
 * so a bus assigned on two dates resolves to the more likely one.
 */
async function resolveSchedule(
  regNum: string,
  requestedDate: string,
  today: string,
  tripId: string | null,
): Promise<ResolveResult> {
  const [primary = requestedDate, ...fallbacks] = candidateDates(requestedDate, today);
  let error: string | null = null;

  const first = await probe(regNum, primary, SCHEDULE_TIMEOUT_MS, tripId);
  if (typeof first === 'string') error = first;
  else if (first.schedule) return { found: first, error: null };

  const rest = await Promise.all(
    fallbacks.map((date) => probe(regNum, date, SCHEDULE_TIMEOUT_MS, tripId)),
  );

  for (const outcome of rest) {
    if (typeof outcome === 'string') {
      error ??= outcome;
      continue;
    }
    if (outcome.schedule) return { found: outcome, error: null };
  }

  // Every candidate answered, none had an assignment — a real "not assigned",
  // worth caching. If nothing answered at all, report the upstream failure.
  if (typeof first !== 'string') return { found: first, error: null };
  return { found: null, error };
}

function noAssignmentMessage(date: string): string {
  return `No UPSRTC schedule assigned to this vehicle (checked ${date} and the preceding operating days).`;
}

function fixtureSchedule(regNum: string, date: string, reason: string | null): ScheduleResponse {
  const schedule = normalizeSchedulePayload(scheduleFixture, regNum, date);
  return {
    schedule,
    fetchedAt: new Date().toISOString(),
    source: 'fixture',
    stale: true,
    message: reason
      ? `Showing UPSRTC fixture fallback (${reason}).`
      : 'Showing UPSRTC fixture fallback.',
  };
}
