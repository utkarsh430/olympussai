import {
  fetchUpstream,
  buildScheduleUrl,
  indiaDate,
  shiftDate,
} from '@/lib/upsrtc/client';
import { normalizeSchedulePayload } from '@/lib/upsrtc/normalizer';
import { normalizeScheduleDay } from '@/lib/upsrtc/scheduleDay';
import type { ScheduledTrip } from '@/lib/depot/service/types';
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
  /** Every trip of the answered day (the schedule above is one of them), stamped with that date. */
  day: readonly ScheduledTrip[];
  /**
   * False when a "not assigned" came with a date that did not answer at all: the
   * server never said so for that date. Only a strict caller tells the two apart.
   */
  everyDateAnswered: boolean;
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
  /**
   * Answer "not assigned" only when every date the lookup tried answered so. A
   * date that failed then makes the lookup a failure (not cached), and a partial
   * answer cached for another caller is not served. Without it a partial answer
   * reads as "not assigned", as the command centre's schedule route has always had.
   */
  readonly requireEveryDateAnswered?: boolean;
  /**
   * Asked once immediately before each call to the schedule server, and the call is
   * made only when it answers true, so a caller can charge each call as it happens. A
   * refusal stops the lookup there: nothing is cached and `ScheduleLookupStopped` is
   * thrown. A cache hit asks nothing. Without it every call is made, as the command
   * centre's schedule route has always done.
   */
  readonly beforeUpstreamCall?: () => boolean;
  /**
   * Handed every trip of the bus's day when the answer is the server's own (fresh or
   * cached), each stamped with the date that answered. Never for "not assigned", a
   * failure or the fixture stand-in. The returned response is the same either way.
   */
  readonly onDay?: (trips: readonly ScheduledTrip[]) => void;
}

/** Hands the day to a caller that asked for it, when there is one to hand. */
function handDay(lookup: ScheduleLookup, options: BusScheduleOptions): void {
  if (lookup.schedule !== null && lookup.day.length > 0) options.onDay?.(lookup.day);
}

/** The caller's `beforeUpstreamCall` refused a call: the lookup stopped and has no answer. */
export class ScheduleLookupStopped extends Error {
  constructor() {
    super('Schedule lookup stopped: a call to the schedule server was not permitted');
    this.name = 'ScheduleLookupStopped';
  }
}

/** A cached lookup a caller may be served: a strict caller never gets a partial "not assigned". */
const servable = (lookup: ScheduleLookup, strict: boolean): boolean =>
  !strict || lookup.schedule !== null || lookup.everyDateAnswered;

/** `today` itself and the days before it that a lookup falls back to. */
const FALLBACK_DAY_OFFSETS = [0, -1, -2] as const;

/**
 * The most calls one lookup can make to the schedule server: the requested date,
 * then each fallback date. A caller that limits calls to that server is asked
 * before each one (`beforeUpstreamCall`), so a lookup is charged only what it makes.
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

  const strict = options.requireEveryDateAnswered === true;
  const cached = cache.get(cacheKey, now);
  if (cached && servable(cached, strict)) {
    handDay(cached, options);
    return {
      schedule: cached.schedule,
      fetchedAt: new Date(now).toISOString(),
      source: 'cache' as const,
      stale: false,
      message: cached.schedule ? undefined : noAssignmentMessage(cached.resolvedDate),
    } satisfies ScheduleResponse;
  }

  if (process.env.NEXT_PUBLIC_DEMO_MODE === '1') {
    return fixtureSchedule(regNum, requestedDate, 'Fixture mode forced', now);
  }

  scheduleDiagnostics.lastAttemptAt = new Date(now).toISOString();
  const resolved = await resolveSchedule(
    regNum,
    requestedDate,
    today,
    tripId,
    options.beforeUpstreamCall ?? (() => true),
  );
  // A stopped lookup has no answer to cache or fall back from.
  if (resolved === STOPPED) throw new ScheduleLookupStopped();
  // A partial "not assigned" is a failure to a strict caller, and is not cached for it.
  const lookup =
    resolved.found && !servable(resolved.found, strict)
      ? { found: null, error: resolved.error }
      : resolved;

  if (lookup.found) {
    cache.set(cacheKey, lookup.found, now);
    handDay(lookup.found, options);
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
    handDay(lastGood.value, options);
    return {
      schedule: lastGood.value.schedule,
      fetchedAt: new Date(lastGood.storedAt).toISOString(),
      source: 'cache' as const,
      stale: true,
    } satisfies ScheduleResponse;
  }

  return fixtureSchedule(regNum, requestedDate, scheduleDiagnostics.lastError, now);
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

/** The lookup stopped because a call was not permitted. */
const STOPPED = Symbol('stopped');

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
    day: normalizeScheduleDay(result.payload, regNum, date),
    everyDateAnswered: true,
  };
}

/**
 * Try the requested date, then fan out across the remaining candidates.
 *
 * The fan-out runs concurrently — sequential probes would stack four timeouts
 * onto a single click — but the winner is still chosen by candidate priority,
 * so a bus assigned on two dates resolves to the more likely one.
 *
 * `permit` is asked immediately before each call, so each call is charged at the
 * moment it is made. The fallback calls are started in candidate order as each is
 * granted; at the first refusal the lookup stops (`STOPPED`). Calls already started
 * then run to their end unobserved: they were granted and made, and their answers
 * alone cannot say what the refused date would have said.
 */
async function resolveSchedule(
  regNum: string,
  requestedDate: string,
  today: string,
  tripId: string | null,
  permit: () => boolean,
): Promise<ResolveResult | typeof STOPPED> {
  const [primary = requestedDate, ...fallbacks] = candidateDates(requestedDate, today);
  let error: string | null = null;

  if (!permit()) return STOPPED;
  const first = await probe(regNum, primary, SCHEDULE_TIMEOUT_MS, tripId);
  if (typeof first === 'string') error = first;
  else if (first.schedule) return { found: first, error: null };

  const started: Promise<ScheduleLookup | string>[] = [];
  for (const date of fallbacks) {
    if (!permit()) {
      // Settled, not awaited: the person is told now, and no rejection goes unhandled.
      void Promise.allSettled(started);
      return STOPPED;
    }
    started.push(probe(regNum, date, SCHEDULE_TIMEOUT_MS, tripId));
  }
  const rest = await Promise.all(started);

  for (const outcome of rest) {
    if (typeof outcome === 'string') {
      error ??= outcome;
      continue;
    }
    if (outcome.schedule) return { found: outcome, error: null };
  }

  // The requested date answered "not assigned" and no date had an assignment. It is
  // a real "not assigned" only if every other date answered too; a failed date's
  // error is kept beside it for the strict caller. If the requested date failed,
  // report the upstream failure.
  if (typeof first !== 'string') {
    return { found: { ...first, everyDateAnswered: error === null }, error };
  }
  return { found: null, error };
}

function noAssignmentMessage(date: string): string {
  return `No UPSRTC schedule assigned to this vehicle (checked ${date} and the preceding operating days).`;
}

function fixtureSchedule(
  regNum: string,
  date: string,
  reason: string | null,
  now: number,
): ScheduleResponse {
  const schedule = normalizeSchedulePayload(scheduleFixture, regNum, date);
  return {
    schedule,
    fetchedAt: new Date(now).toISOString(),
    source: 'fixture',
    stale: true,
    message: reason
      ? `Showing UPSRTC fixture fallback (${reason}).`
      : 'Showing UPSRTC fixture fallback.',
  };
}
