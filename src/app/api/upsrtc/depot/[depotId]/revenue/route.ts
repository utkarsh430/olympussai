import type { NextRequest } from 'next/server';
import { jsonResponse } from '@/lib/upsrtc/respond';
import { requireUpsrtcAccess, unauthorizedResponse } from '@/lib/auth/authorize';
import { isValidDepotId } from '@/lib/depot/ids';
import { getRepositories } from '@/lib/depot/repositories';
import { logDepotError } from '@/lib/serverLog';
import { buildRevenueResponse } from '@/lib/depot/live/revenueView';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface RouteContext {
  readonly params: Promise<{ depotId: string }>;
}

export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  // Independent authorization check — never rely on middleware alone.
  const session = await requireUpsrtcAccess();
  if (!session) return unauthorizedResponse();

  // A hostile id is refused before it reaches a lookup, a cache key or a response.
  const { depotId } = await context.params;
  if (!isValidDepotId(depotId)) return jsonResponse({ error: 'Invalid depot id' }, { status: 400 });

  const acceptEncoding = request.headers.get('accept-encoding');
  try {
    const repositories = getRepositories();
    const view = await repositories.fleet.snapshot();
    const response = await buildRevenueResponse(view, depotId, repositories);
    if (!response) return jsonResponse({ error: 'Depot not found' }, { status: 404 });
    return jsonResponse(response, { acceptEncoding });
  } catch (error) {
    // The message can name hosts or carry tokens, so it stays on the server.
    logDepotError('revenue-api', error);
    return jsonResponse({ error: 'Depot data unavailable' }, { status: 503 });
  }
}
