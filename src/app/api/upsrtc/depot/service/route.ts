import type { NextRequest } from 'next/server';
import { jsonResponse } from '@/lib/upsrtc/respond';
import { requireUpsrtcAccess, unauthorizedResponse } from '@/lib/auth/authorize';
import { getRepositories, getServiceRepositories } from '@/lib/depot/repositories';
import { buildNetworkHourlyResponse, parseNetworkHourlyQuery } from '@/lib/depot/live/networkHourlyView';
import { logDepotError } from '@/lib/serverLog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * The network's day hour by hour for one band: the routes short and over, one page of
 * route strips, the proposals and the hourly reallocation. Recommendation only: nothing is
 * dispatched, and no upstream call is made.
 */
export async function GET(request: NextRequest): Promise<Response> {
  // Independent authorization check — never rely on middleware alone.
  const session = await requireUpsrtcAccess();
  if (!session) return unauthorizedResponse();

  // A malformed query is refused before any snapshot is read.
  const parsed = parseNetworkHourlyQuery(request.nextUrl.searchParams);
  if (!parsed.ok) return jsonResponse({ error: 'Invalid query' }, { status: 400 });

  const acceptEncoding = request.headers.get('accept-encoding');
  try {
    const view = await getRepositories().fleet.snapshot();
    const { status, body } = await buildNetworkHourlyResponse(view, parsed.query, getServiceRepositories());
    return jsonResponse(body, { status, acceptEncoding });
  } catch (error) {
    // The upstream message can name hosts or carry tokens; it is logged, never returned.
    logDepotError('network-hourly-api', error);
    return jsonResponse({ error: 'Depot data unavailable' }, { status: 503 });
  }
}
