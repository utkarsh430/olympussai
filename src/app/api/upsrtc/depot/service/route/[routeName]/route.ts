import type { NextRequest } from 'next/server';
import { jsonResponse } from '@/lib/upsrtc/respond';
import { requireUpsrtcAccess, unauthorizedResponse } from '@/lib/auth/authorize';
import { isValidRouteName } from '@/lib/depot/ids';
import { getRepositories, getServiceRepositories } from '@/lib/depot/repositories';
import { buildRouteHourlyResponse, parseRouteHourlyQuery } from '@/lib/depot/live/routeHourlyView';
import { logDepotError } from '@/lib/serverLog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface RouteContext {
  readonly params: Promise<{ routeName: string }>;
}

/**
 * One route's day hour by hour: deployed, scheduled and needed buses, the gap and the
 * proposals. Recommendation only: nothing is dispatched, and no upstream call is made.
 */
export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  // Independent authorization check — never rely on middleware alone.
  const session = await requireUpsrtcAccess();
  if (!session) return unauthorizedResponse();

  // A hostile name is refused before it reaches a lookup, a cache key or a response.
  const { routeName } = await context.params;
  if (!isValidRouteName(routeName)) {
    return jsonResponse({ error: 'Invalid route name' }, { status: 400 });
  }
  // A malformed query is refused before any snapshot is read.
  const parsed = parseRouteHourlyQuery(routeName, request.nextUrl.searchParams);
  if (!parsed.ok) return jsonResponse({ error: 'Invalid query' }, { status: 400 });

  const acceptEncoding = request.headers.get('accept-encoding');
  try {
    const view = await getRepositories().fleet.snapshot();
    const { status, body } = await buildRouteHourlyResponse(
      view,
      parsed.query,
      getServiceRepositories(),
    );
    return jsonResponse(body, { status, acceptEncoding });
  } catch (error) {
    // The upstream message can name hosts or carry tokens; it is logged, never returned.
    logDepotError('route-hourly-api', error);
    return jsonResponse({ error: 'Depot data unavailable' }, { status: 503 });
  }
}
