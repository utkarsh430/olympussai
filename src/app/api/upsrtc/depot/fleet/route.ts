import type { NextRequest } from 'next/server';
import { jsonResponse } from '@/lib/upsrtc/respond';
import { requireUpsrtcAccess, unauthorizedResponse } from '@/lib/auth/authorize';
import { getRepositories } from '@/lib/depot/repositories';
import { logDepotError } from '@/lib/serverLog';
import { buildFleetIndex } from '@/lib/depot/os/fleetIndex';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** Every bus on the snapshot as a compact row, for Depot Intelligence OS's network engines. */
export async function GET(request: NextRequest): Promise<Response> {
  // Independent authorization check — never rely on middleware alone.
  const session = await requireUpsrtcAccess();
  if (!session) return unauthorizedResponse();

  const acceptEncoding = request.headers.get('accept-encoding');
  try {
    const view = await getRepositories().fleet.snapshot();
    return jsonResponse(buildFleetIndex(view), { acceptEncoding });
  } catch (error) {
    // The message can name hosts or carry tokens, so it stays on the server.
    logDepotError('fleet-api', error);
    return jsonResponse({ error: 'Depot data unavailable' }, { status: 503 });
  }
}
