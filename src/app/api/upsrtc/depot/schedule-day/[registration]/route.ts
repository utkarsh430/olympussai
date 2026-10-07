import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireUpsrtcAccess, unauthorizedResponse } from '@/lib/auth/authorize';
import { jsonResponse } from '@/lib/upsrtc/respond';
import { isValidRegistrationNumber } from '@/lib/upsrtc/client';
import { isValidRouteName } from '@/lib/depot/ids';
import { logDepotError } from '@/lib/serverLog';
import type { IdentityClaims } from '@/lib/depot/rateLimit';
import { ROUTE_LOOKUP_DEADLINE_MS } from '@/lib/depot/routes/routeCatalogue';
import {
  PAST_DEADLINE,
  tooManyRequests,
  upstreamPermit,
  withinDeadline,
} from '@/lib/depot/routes/upstreamPermit';
import { getRepositories, getServiceRepositories } from '@/lib/depot/repositories';
import { feedEnvelope } from '@/lib/depot/live/analysis';
import { lookUpScheduleDay } from '@/lib/depot/service/scheduleDayLookup';
import type { ScheduleDayResponse } from '@/lib/depot/service/scheduleDayApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface RouteContext {
  readonly params: Promise<{ registration: string }>;
}

/** The longest registration the fleet uses is 11 characters; anything longer is refused unread. */
const MAX_REGISTRATION_LENGTH = 16;

const INVALID = { error: 'Invalid request' } as const;
const NOT_ON_ROUTE = { error: 'Bus not seen on this route' } as const;
const UNAVAILABLE = { error: 'Schedule data unavailable' } as const;

const querySchema = z.object({ route: z.string().refine(isValidRouteName) }).strict();

/** The upper-cased registration and the route, or null for anything malformed, unknown or repeated. */
function parse(
  registration: unknown,
  searchParams: URLSearchParams,
): { readonly registration: string; readonly routeName: string } | null {
  if (typeof registration !== 'string' || registration.length > MAX_REGISTRATION_LENGTH) return null;
  if (!isValidRegistrationNumber(registration) || registration.trim() !== registration) return null;
  const keys = [...searchParams.keys()];
  if (new Set(keys).size !== keys.length) return null;
  const parsed = querySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) return null;
  return { registration: registration.toUpperCase(), routeName: parsed.data.route };
}

async function answer(
  request: NextRequest,
  session: Readonly<IdentityClaims>,
  asked: { readonly registration: string; readonly routeName: string },
): Promise<Response> {
  const acceptEncoding = request.headers.get('accept-encoding');
  const view = await getRepositories().fleet.snapshot();
  // Each call to the government's server takes its slot from the same limits as the
  // route lookup, immediately before it is made.
  const outcome = await lookUpScheduleDay({
    ...asked,
    view,
    services: getServiceRepositories(),
    permit: upstreamPermit(request, session),
    now: Date.now(),
  });
  if (outcome.status === 'limited') return tooManyRequests(outcome.retryAfterSeconds);
  if (outcome.status === 'not_on_route') {
    return jsonResponse(NOT_ON_ROUTE, { status: 404, acceptEncoding });
  }
  const body: ScheduleDayResponse = { ...outcome, ...feedEnvelope(view) };
  return jsonResponse(body, { acceptEncoding });
}

/**
 * GET /api/upsrtc/depot/schedule-day/[registration]?route=<name>: one bus's whole day,
 * looked up because a person asked, recorded as that route's scheduled supply. Session
 * first; a strict registration and route; a bus this server has not seen on the route is
 * the fixed 404; a call past a limit the fixed 429 with `Retry-After`; past the deadline
 * or on any failure the fixed 503. Never cached.
 */
export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  // Independent authorization check — never rely on middleware alone.
  const session = await requireUpsrtcAccess();
  if (!session) return unauthorizedResponse();

  const acceptEncoding = request.headers.get('accept-encoding');
  const { registration } = await context.params;
  const asked = parse(registration, new URL(request.url).searchParams);
  if (asked === null) return jsonResponse(INVALID, { status: 400, acceptEncoding });

  try {
    const outcome = await withinDeadline(answer(request, session, asked), ROUTE_LOOKUP_DEADLINE_MS);
    if (outcome !== PAST_DEADLINE) return outcome;
    logDepotError('schedule-day-api', new Error('A bus day took longer than the route allows'));
  } catch (error) {
    logDepotError('schedule-day-api', error);
  }
  return jsonResponse(UNAVAILABLE, { status: 503, acceptEncoding });
}
