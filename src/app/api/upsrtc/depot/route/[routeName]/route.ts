import type { NextRequest } from 'next/server';
import { requireUpsrtcAccess, unauthorizedResponse } from '@/lib/auth/authorize';
import { jsonResponse } from '@/lib/upsrtc/respond';
import { isValidRouteName } from '@/lib/depot/ids';
import { logDepotError } from '@/lib/serverLog';
import type { IdentityClaims } from '@/lib/depot/rateLimit';
import { getRouteProfile, ROUTE_LOOKUP_DEADLINE_MS } from '@/lib/depot/routes/routeCatalogue';
import {
  PAST_DEADLINE,
  tooManyRequests,
  upstreamPermit,
  withinDeadline,
} from '@/lib/depot/routes/upstreamPermit';
import type { RouteProfileResponse } from '@/lib/depot/routes/types';
import { getRepositories, getServiceRepositories } from '@/lib/depot/repositories';
import { feedEnvelope } from '@/lib/depot/live/analysis';
import type { ScheduledTrip } from '@/lib/depot/service/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface RouteContext {
  readonly params: Promise<{ routeName: string }>;
}

/** A successful lookup's whole bus day goes to the scheduled-trip store, at no further call. */
const recordBusDay = (trips: readonly ScheduledTrip[]): Promise<void> =>
  getServiceRepositories().scheduled.recordBusDay(trips);

/** The 429 when a call the lookup needed would pass a limit, else the profile body. */
async function answer(
  request: NextRequest,
  session: Readonly<IdentityClaims>,
  routeName: string,
): Promise<Response> {
  const acceptEncoding = request.headers.get('accept-encoding');
  const now = Date.now();
  const view = await getRepositories().fleet.snapshot();
  // Only a call to the government's server is limited, each one as it is made: a
  // cache hit costs nothing, a lookup the calls it makes.
  const permit = upstreamPermit(request, session);
  const result = await getRouteProfile(routeName, view, now, permit, recordBusDay);
  if (result.status === 'limited') return tooManyRequests(result.retryAfterSeconds);
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
