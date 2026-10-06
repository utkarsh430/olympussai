import type { NextRequest } from 'next/server';
import { jsonResponse } from '@/lib/upsrtc/respond';
import { requireUpsrtcAccess, unauthorizedResponse } from '@/lib/auth/authorize';
import { getLiveSnapshot } from '@/lib/upsrtc/liveSnapshot';
import type { LiveFeedResponse } from '@/models/canonical';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<Response> {
  // Independent authorization check — never rely on middleware alone.
  const session = await requireUpsrtcAccess();
  if (!session) return unauthorizedResponse();

  const acceptEncoding = request.headers.get('accept-encoding');
  const { snapshot, source, stale } = await getLiveSnapshot(Date.now());

  const body: LiveFeedResponse = {
    buses: snapshot.buses,
    // A fixture response is stamped with the current time, not the time the
    // sample was normalised; live and cached responses keep the build time.
    fetchedAt: source === 'fixture' ? new Date().toISOString() : snapshot.fetchedAt,
    source,
    stale,
    recordCount: snapshot.recordCount,
    rejectedRecordCount: snapshot.rejectedRecordCount,
  };
  return jsonResponse(body, { acceptEncoding });
}
