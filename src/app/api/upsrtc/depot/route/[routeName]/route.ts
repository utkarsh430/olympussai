import type { NextRequest } from 'next/server';
import { requireUpsrtcAccess, unauthorizedResponse } from '@/lib/auth/authorize';
import { jsonResponse } from '@/lib/upsrtc/respond';
import { getLiveSnapshot } from '@/lib/upsrtc/liveSnapshot';
import { isValidRouteName } from '@/lib/depot/ids';
import { logDepotError } from '@/lib/depot/log';
import { getRouteProfile } from '@/lib/depot/routes/routeCatalogue';
import type { RouteProfileResponse } from '@/lib/depot/routes/types';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface RouteContext {
  readonly params: Promise<{ routeName: string }>;
}

// TODO: read the fleet through the repository once its composition root lands.
async function readFleetView(now: number): Promise<FleetSnapshotView> {
  const { snapshot, source, stale } = await getLiveSnapshot(now);
  return {
    rows: snapshot.depotRows,
    feedNow: snapshot.feedNow,
    fetchedAt: snapshot.fetchedAt,
    source,
    stale,
    recordCount: snapshot.recordCount,
  };
}

export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  // Independent authorization check — never rely on middleware alone.
  const session = await requireUpsrtcAccess();
  if (!session) return unauthorizedResponse();

  const acceptEncoding = request.headers.get('accept-encoding');
  const { routeName } = await context.params;
  if (!isValidRouteName(routeName)) {
    return jsonResponse({ error: 'Invalid route name' }, { status: 400, acceptEncoding });
  }

  try {
    const now = Date.now();
    const view = await readFleetView(now);
    const result = await getRouteProfile(routeName, view, now);
    const body: RouteProfileResponse = { ...result, fetchedAt: new Date(now).toISOString() };
    return jsonResponse(body, { acceptEncoding });
  } catch (error) {
    logDepotError('route-api', error);
    return jsonResponse({ error: 'Route data unavailable' }, { status: 503, acceptEncoding });
  }
}
