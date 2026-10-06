import type { NextRequest } from 'next/server';
import { jsonResponse } from '@/lib/upsrtc/respond';
import { requireUpsrtcAccess, unauthorizedResponse } from '@/lib/auth/authorize';
import { getRepositories } from '@/lib/depot/repositories';
import { logDepotError } from '@/lib/depot/log';
import { buildEconomicsResponse } from '@/lib/depot/live/economicsView';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: NextRequest): Promise<Response> {
  // Independent authorization check — never rely on middleware alone.
  const session = await requireUpsrtcAccess();
  if (!session) return unauthorizedResponse();

  const acceptEncoding = request.headers.get('accept-encoding');
  try {
    const repositories = getRepositories();
    const view = await repositories.fleet.snapshot();
    return jsonResponse(await buildEconomicsResponse(view, repositories), { acceptEncoding });
  } catch (error) {
    // The message can name hosts or carry tokens, so it stays on the server.
    logDepotError('economics-api', error);
    return jsonResponse({ error: 'Depot data unavailable' }, { status: 503 });
  }
}
