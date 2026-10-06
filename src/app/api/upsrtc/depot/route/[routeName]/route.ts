import type { NextRequest } from 'next/server';
import { requireUpsrtcAccess, unauthorizedResponse } from '@/lib/auth/authorize';
import { jsonResponse } from '@/lib/upsrtc/respond';
import { isValidRouteName } from '@/lib/depot/ids';
import { logDepotError } from '@/lib/depot/log';
import {
  createWindowLimiter,
  requestAddress, requestIdentity,
  ROUTE_PROFILE_FETCH_LIMITS,
  takeAll,
  type IdentityClaims,
  type WindowLimiter,
} from '@/lib/depot/rateLimit';
import {
  getRouteProfile,
  ROUTE_LOOKUP_DEADLINE_MS,
  routeProfileNeedsFetch,
} from '@/lib/depot/routes/routeCatalogue';
import type { RouteProfileResponse } from '@/lib/depot/routes/types';
import { getRepositories } from '@/lib/depot/repositories';
import { feedEnvelope } from '@/lib/depot/live/analysis';
import { SCHEDULE_MAX_UPSTREAM_CALLS } from '@/lib/upsrtc/scheduleService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface RouteContext {
  readonly params: Promise<{ routeName: string }>;
}

interface FetchLimiters {
  readonly identity: WindowLimiter;
  readonly process: WindowLimiter;
  /** Keyed on the trusted address alone, so a new login from it gains nothing. */
  readonly address: WindowLimiter;
}

const LIMITERS_KEY = Symbol.for('olympuss.depot.routeProfileFetchLimiters');
type LimiterHolder = typeof globalThis & { [LIMITERS_KEY]?: FetchLimiters };

/** One pair per process, on `globalThis` so a hot reload does not reset the limits. */
function fetchLimiters(): FetchLimiters {
  const holder = globalThis as LimiterHolder;
  const { perIdentityPerMinute, perAddressPerMinute, perProcessPerMinute, windowMs } =
    ROUTE_PROFILE_FETCH_LIMITS;
  const { maxIdentities } = ROUTE_PROFILE_FETCH_LIMITS;
  const made = (limit: number, maxKeys: number): WindowLimiter =>
    createWindowLimiter({ now: Date.now, limit, windowMs, maxKeys });
  holder[LIMITERS_KEY] ??= {
    identity: made(perIdentityPerMinute, maxIdentities),
    process: made(perProcessPerMinute, 1),
    address: made(perAddressPerMinute, maxIdentities),
  };
  return holder[LIMITERS_KEY];
}

/** Null when the request may go on; a 429 when this cache miss would pass a limit. */
function throttleMiss(request: NextRequest, claims: Readonly<IdentityClaims>): Response | null {
  const limiters = fetchLimiters();
  const address = requestAddress(request.headers, process.env);
  // The limits count calls to the schedule server, so a miss is charged the most a lookup can make.
  const cost = SCHEDULE_MAX_UPSTREAM_CALLS;
  const identity = requestIdentity(claims, request.headers, process.env);
  const decision = takeAll([
    { limiter: limiters.identity, key: identity, cost },
    ...(address === null ? [] : [{ limiter: limiters.address, key: address, cost }]),
    { limiter: limiters.process, key: 'all', cost },
  ]);
  if (!decision.limited) return null;
  const { retryAfterSeconds } = decision;
  return Response.json(
    { error: 'Too many requests', retryAfterSeconds },
    {
      status: 429,
      headers: { 'Cache-Control': 'no-store', 'Retry-After': String(retryAfterSeconds) },
    },
  );
}

const PAST_DEADLINE = Symbol('past deadline');

/** The work's own outcome, or `PAST_DEADLINE` once `ms` have gone by; no timer is left behind. */
async function withinDeadline<T>(work: Promise<T>, ms: number): Promise<T | typeof PAST_DEADLINE> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<typeof PAST_DEADLINE>((resolve) => {
    timer = setTimeout(() => resolve(PAST_DEADLINE), ms);
  });
  try {
    return await Promise.race([work, expiry]);
  } finally {
    clearTimeout(timer);
  }
}

/** The 429 when this miss would pass a limit, else the profile body. */
async function answer(
  request: NextRequest,
  session: Readonly<IdentityClaims>,
  routeName: string,
): Promise<Response> {
  const acceptEncoding = request.headers.get('accept-encoding');
  const now = Date.now();
  const view = await getRepositories().fleet.snapshot();
  // Only a cache miss reaches the government's server, so only a miss is limited.
  if (routeProfileNeedsFetch(routeName, view, now)) {
    const refused = throttleMiss(request, session);
    if (refused) return refused;
  }
  const result = await getRouteProfile(routeName, view, now);
  // The envelope is the snapshot's own, so a stale or sample fleet says so here too.
  const body: RouteProfileResponse = { ...result, ...feedEnvelope(view) };
  return jsonResponse(body, { acceptEncoding });
}

export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  // Independent authorization check — never rely on middleware alone.
  const session = await requireUpsrtcAccess();
  if (!session) return unauthorizedResponse();

  const acceptEncoding = request.headers.get('accept-encoding');
  const { routeName } = await context.params;
  if (!isValidRouteName(routeName)) {
    return jsonResponse({ error: 'Invalid route name' }, { status: 400, acceptEncoding });
  }

  try {
    const outcome = await withinDeadline(
      answer(request, session, routeName),
      ROUTE_LOOKUP_DEADLINE_MS,
    );
    if (outcome !== PAST_DEADLINE) return outcome;
    logDepotError('route-api', new Error('Route details took longer than the route allows'));
  } catch (error) {
    logDepotError('route-api', error);
  }
  return jsonResponse({ error: 'Route data unavailable' }, { status: 503, acceptEncoding });
}
