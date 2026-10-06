import type { NextRequest } from 'next/server';
import { jsonResponse } from '@/lib/upsrtc/respond';
import { requireUpsrtcAccess, unauthorizedResponse } from '@/lib/auth/authorize';
import { isValidDepotId } from '@/lib/depot/ids';
import { getRepositories } from '@/lib/depot/repositories';
import { logDepotError } from '@/lib/serverLog';
import { buildDepotDetail } from '@/lib/depot/live/depotView';

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
    const view = await getRepositories().fleet.snapshot();
    const detail = buildDepotDetail(view, depotId);
    if (!detail) return jsonResponse({ error: 'Depot not found' }, { status: 404 });
    return jsonResponse(detail, { acceptEncoding });
  } catch (error) {
    // Logged so a bug here is visible; the message can name hosts or carry
    // tokens, so it never leaves the server.
    logDepotError('depot-api', error);
    return jsonResponse({ error: 'Depot data unavailable' }, { status: 503 });
  }
}
