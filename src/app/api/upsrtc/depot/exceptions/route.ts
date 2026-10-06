import type { NextRequest } from 'next/server';
import { jsonResponse } from '@/lib/upsrtc/respond';
import { requireUpsrtcAccess, unauthorizedResponse } from '@/lib/auth/authorize';
import { getRepositories } from '@/lib/depot/repositories';
import { logDepotError } from '@/lib/serverLog';
import { DEPOT_NOT_FOUND, depotFilterKnown } from '@/lib/depot/live/analysis';
import { parseBusPageQuery } from '@/lib/depot/exceptions/busPage';
import { buildPagedExceptionsResponse } from '@/lib/depot/live/exceptionView';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: NextRequest): Promise<Response> {
  // Independent authorization check — never rely on middleware alone.
  const session = await requireUpsrtcAccess();
  if (!session) return unauthorizedResponse();

  // A malformed query is refused before any snapshot is read.
  const parsed = parseBusPageQuery(request.nextUrl.searchParams);
  if (!parsed.ok) return jsonResponse({ error: 'Invalid query' }, { status: 400 });

  const acceptEncoding = request.headers.get('accept-encoding');
  try {
    const view = await getRepositories().fleet.snapshot();
    // A well-formed depot id the feed does not have is a 404, as on the depot routes.
    if (!depotFilterKnown(view, parsed.query.depotId)) {
      return jsonResponse(DEPOT_NOT_FOUND, { status: 404 });
    }
    return jsonResponse(buildPagedExceptionsResponse(view, parsed.query), { acceptEncoding });
  } catch (error) {
    // Logged so a bug here is visible; the message can name hosts or carry
    // tokens, so it never leaves the server.
    logDepotError('exceptions-api', error);
    return jsonResponse({ error: 'Depot data unavailable' }, { status: 503 });
  }
}
