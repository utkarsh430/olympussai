import type { NextRequest } from 'next/server';
import { jsonResponse } from '@/lib/upsrtc/respond';
import { z } from 'zod';
import {
  fetchUpstream,
  buildScheduleUrl,
  indiaDate,
  isValidRegistrationNumber,
  shiftDate,
} from '@/lib/upsrtc/client';
import { normalizeSchedulePayload } from '@/lib/upsrtc/normalizer';
import { TtlCache } from '@/lib/upsrtc/cache';
import scheduleFixture from '@/fixtures/upsrtc-schedule-sample.json';
import type { CanonicalSchedule, ScheduleResponse } from '@/models/canonical';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

const cache = new TtlCache<ScheduleLookup>(CACHE_TTL_MS);

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

const querySchema = z.object({
  regNum: z
    .string()
    .min(4)
    .max(16)
    .refine(isValidRegistrationNumber, { message: 'Malformed registration number' }),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
    .optional(),
  /** Live vehicle_journey_id, used to pick the running trip out of the day's list. */
  tripId: z.string().min(1).max(32).optional(),
});

export async function GET(request: NextRequest): Promise<Response> {
  const acceptEncoding = request.headers.get('accept-encoding');
  const { searchParams } = new URL(request.url);

  const parsed = querySchema.safeParse({
    regNum: searchParams.get('regNum') ?? '',
    date: searchParams.get('date') ?? undefined,
    tripId: searchParams.get('tripId') ?? undefined,
  });

  if (!parsed.success) {
    return jsonResponse({
        schedule: null,
        fetchedAt: new Date().toISOString(),
        source: 'live' as const,
        stale: false,
        message: parsed.error.issues[0]?.message ?? 'Invalid request',
      } satisfies ScheduleResponse, { status: 400, acceptEncoding });
  }

  const regNum = parsed.data.regNum.toUpperCase();
  const today = indiaDate();
  const requestedDate = parsed.data.date ?? today;
  const tripId = parsed.data.tripId ?? null;
  // The trip id selects which journey is returned, so it belongs in the key.
  const cacheKey = `${regNum}:${requestedDate}:${tripId ?? '-'}`;
  const now = Date.now();

  scheduleDiagnostics.requestCount += 1;

  const cached = cache.get(cacheKey, now);
  if (cached) {
    return jsonResponse({
        schedule: cached.schedule,
        fetchedAt: new Date(now).toISOString(),
        source: 'cache' as const,
        stale: false,
        message: cached.schedule ? undefined : noAssignmentMessage(cached.resolvedDate),
      } satisfies ScheduleResponse, { acceptEncoding });
  }

  if (process.env.NEXT_PUBLIC_DEMO_MODE === '1') {
    return jsonResponse(fixtureSchedule(regNum, requestedDate, 'Fixture mode forced'), { acceptEncoding });
  }

  scheduleDiagnostics.lastAttemptAt = new Date(now).toISOString();
  const lookup = await resolveSchedule(regNum, requestedDate, today, tripId);

  if (lookup.found) {
    cache.set(cacheKey, lookup.found, now);
    scheduleDiagnostics.lastSuccessAt = new Date(now).toISOString();
    scheduleDiagnostics.lastError = null;

    return jsonResponse({
        schedule: lookup.found.schedule,
        fetchedAt: new Date(now).toISOString(),
        source: 'live' as const,
        stale: false,
        message: lookup.found.schedule ? undefined : noAssignmentMessage(lookup.found.resolvedDate),
      } satisfies ScheduleResponse, { acceptEncoding });
  }

  scheduleDiagnostics.lastError = lookup.error ?? 'Unknown upstream failure';

  const lastGood = cache.getLastGood(cacheKey);
  if (lastGood?.value.schedule) {
    return jsonResponse({
        schedule: lastGood.value.schedule,
        fetchedAt: new Date(lastGood.storedAt).toISOString(),
        source: 'cache' as const,
        stale: true,
      } satisfies ScheduleResponse, { acceptEncoding });
  }

  return jsonResponse(fixtureSchedule(regNum, requestedDate, scheduleDiagnostics.lastError), { acceptEncoding });
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
  return [...new Set([requested, today, shiftDate(today, -1), shiftDate(today, -2)])];
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
