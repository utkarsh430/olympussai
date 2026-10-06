import type { NextRequest } from 'next/server';
import { jsonResponse } from '@/lib/upsrtc/respond';
import { requireUpsrtcAccess, unauthorizedResponse } from '@/lib/auth/authorize';
import { getRepositories } from '@/lib/depot/repositories';
import { logDepotError } from '@/lib/depot/log';
import { buildNetworkResponse } from '@/lib/depot/live/networkView';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: NextRequest): Promise<Response> {
  // Independent authorization check — never rely on middleware alone.
  const session = await requireUpsrtcAccess();
  if (!session) return unauthorizedResponse();

  const acceptEncoding = request.headers.get('accept-encoding');
  try {
    const view = await getRepositories().fleet.snapshot();
    return jsonResponse(buildNetworkResponse(view), { acceptEncoding });
  } catch (error) {
    // Logged so a bug here is visible; the message can name hosts or carry
    // tokens, so it never leaves the server.
    logDepotError('network-api', error);
    return jsonResponse({ error: 'Depot data unavailable' }, { status: 503 });
  }
}
