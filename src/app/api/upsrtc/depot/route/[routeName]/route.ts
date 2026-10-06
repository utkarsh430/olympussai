import type { NextRequest } from 'next/server';
import { requireUpsrtcAccess, unauthorizedResponse } from '@/lib/auth/authorize';
import { jsonResponse } from '@/lib/upsrtc/respond';
import { getLiveSnapshot } from '@/lib/upsrtc/liveSnapshot';
import { isValidRouteName } from '@/lib/depot/ids';
import { logDepotError } from '@/lib/depot/log';
import {
  createWindowLimiter,
  requestIdentity,
  ROUTE_PROFILE_FETCH_LIMITS,
  takeAll,
  type IdentityClaims,
  type WindowLimiter,
} from '@/lib/depot/rateLimit';
import { getRouteProfile, routeProfileNeedsFetch } from '@/lib/depot/routes/routeCatalogue';
import type { RouteProfileResponse } from '@/lib/depot/routes/types';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface RouteContext {
  readonly params: Promise<{ routeName: string }>;
}

interface FetchLimiters {
  readonly identity: WindowLimiter;
  readonly process: WindowLimiter;
}

const LIMITERS_KEY = Symbol.for('olympuss.depot.routeProfileFetchLimiters');
type LimiterHolder = typeof globalThis & { [LIMITERS_KEY]?: FetchLimiters };

/** One pair per process, on `globalThis` so a hot reload does not reset the limits. */
function fetchLimiters(): FetchLimiters {
  const holder = globalThis as LimiterHolder;
  const { perIdentityPerMinute, perProcessPerMinute, windowMs, maxIdentities } =
    ROUTE_PROFILE_FETCH_LIMITS;
  const made = (limit: number, maxKeys: number): WindowLimiter =>
    createWindowLimiter({ now: Date.now, limit, windowMs, maxKeys });
  holder[LIMITERS_KEY] ??= {
    identity: made(perIdentityPerMinute, maxIdentities),
    process: made(perProcessPerMinute, 1),
  };
  return holder[LIMITERS_KEY];
}

/** Null when the request may go on; a 429 when this cache miss would pass a limit. */
function throttleMiss(request: NextRequest, claims: Readonly<IdentityClaims>): Response | null {
  const limiters = fetchLimiters();
  const decision = takeAll([
    { limiter: limiters.identity, key: requestIdentity(claims, request.headers, process.env) },
    { limiter: limiters.process, key: 'all' },
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

// TODO: read the fleet through the repository once its composition root lands.
async function readFleetView(now: number): Promise<FleetSnapshotView> {
  const { snapshot, source, stale } = await getLiveSnapshot(now);
  return {
    rows: snapshot.depotRows,
    feedNow: snapshot.feedNow,
    fetchedAt: snapshot.fetchedAt,
    source,
    stale,
    recordCount: snapshot.recordCount,
  };
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
    const now = Date.now();
    const view = await readFleetView(now);
    // Only a cache miss reaches the government's server, so only a miss is limited.
    if (routeProfileNeedsFetch(routeName, view, now)) {
      const refused = throttleMiss(request, session);
      if (refused) return refused;
    }
    const result = await getRouteProfile(routeName, view, now);
    const body: RouteProfileResponse = { ...result, fetchedAt: new Date(now).toISOString() };
    return jsonResponse(body, { acceptEncoding });
  } catch (error) {
    logDepotError('route-api', error);
    return jsonResponse({ error: 'Route data unavailable' }, { status: 503, acceptEncoding });
  }
}
