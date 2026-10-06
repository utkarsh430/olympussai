import type { NextRequest } from 'next/server';
import { jsonResponse } from '@/lib/upsrtc/respond';
import { requireUpsrtcAccess, unauthorizedResponse } from '@/lib/auth/authorize';
import { getRepositories } from '@/lib/depot/repositories';
import { buildDistributionResponse } from '@/lib/depot/live/distributionView';
import { logDepotError } from '@/lib/depot/log';

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
    return jsonResponse(buildDistributionResponse(view), { acceptEncoding });
  } catch (error) {
    // The upstream message can name hosts or carry tokens; it is logged, never returned.
    logDepotError('distribution-api', error);
    return jsonResponse({ error: 'Depot data unavailable' }, { status: 503 });
  }
}
