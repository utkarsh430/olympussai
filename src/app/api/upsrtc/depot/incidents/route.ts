import type { NextRequest } from 'next/server';
import { jsonResponse } from '@/lib/upsrtc/respond';
import { requireUpsrtcAccess, unauthorizedResponse } from '@/lib/auth/authorize';
import { getRepositories, getServiceRepositories } from '@/lib/depot/repositories';
import { buildIncidentRollup } from '@/lib/depot/live/incidentRollupView';
import { logDepotError } from '@/lib/serverLog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** Every depot's suspected incidents, built a batch of depots per request. */
export async function GET(request: NextRequest): Promise<Response> {
  // Independent authorization check — never rely on middleware alone.
  const session = await requireUpsrtcAccess();
  if (!session) return unauthorizedResponse();
  const acceptEncoding = request.headers.get('accept-encoding');
  try {
    const repositories = getRepositories();
    const view = await repositories.fleet.snapshot();
    const response = await buildIncidentRollup(view, repositories.crew, getServiceRepositories(), () => Date.now());
    return jsonResponse(response, { acceptEncoding });
  } catch (error) {
    logDepotError('incidents-rollup-api', error);
    return jsonResponse({ error: 'Depot data unavailable' }, { status: 503 });
  }
}
