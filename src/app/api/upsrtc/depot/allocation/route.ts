import type { NextRequest } from 'next/server';
import { jsonResponse } from '@/lib/upsrtc/respond';
import { requireUpsrtcAccess, unauthorizedResponse } from '@/lib/auth/authorize';
import { getRepositories } from '@/lib/depot/repositories';
import { buildAllocationResponse, parseAllocationQuery } from '@/lib/depot/live/allocationView';
import { logDepotError } from '@/lib/depot/log';
import { DEPOT_NOT_FOUND, depotFilterKnown } from '@/lib/depot/live/analysis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Recommended route-to-depot allocation over the routes already profiled.
 * Recommendation only: nothing is reassigned, and no profile is fetched.
 */
export async function GET(request: NextRequest): Promise<Response> {
  // Independent authorization check — never rely on middleware alone.
  const session = await requireUpsrtcAccess();
  if (!session) return unauthorizedResponse();

  // A malformed query is refused before any snapshot is read.
  const parsed = parseAllocationQuery(request.nextUrl.searchParams);
  if (!parsed.ok) return jsonResponse({ error: 'Invalid query' }, { status: 400 });

  const acceptEncoding = request.headers.get('accept-encoding');
  try {
    const view = await getRepositories().fleet.snapshot();
    // A well-formed depot id the feed does not have is a 404, as on the depot routes.
    if (!depotFilterKnown(view, parsed.query.depotId)) {
      return jsonResponse(DEPOT_NOT_FOUND, { status: 404 });
    }
    return jsonResponse(buildAllocationResponse(view, parsed.query), { acceptEncoding });
  } catch (error) {
    // The upstream message can name hosts or carry tokens; it is logged, never returned.
    logDepotError('allocation-api', error);
    return jsonResponse({ error: 'Depot data unavailable' }, { status: 503 });
  }
}
