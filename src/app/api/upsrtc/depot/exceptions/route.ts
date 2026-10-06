import type { NextRequest } from 'next/server';
import { jsonResponse } from '@/lib/upsrtc/respond';
import { requireUpsrtcAccess, unauthorizedResponse } from '@/lib/auth/authorize';
import { getRepositories } from '@/lib/depot/repositories';
import { buildExceptionsResponse } from '@/lib/depot/live/exceptionView';

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
    return jsonResponse(buildExceptionsResponse(view), { acceptEncoding });
  } catch {
    // The upstream message can name hosts or carry tokens; it never leaves the server.
    return jsonResponse({ error: 'Depot data unavailable' }, { status: 503 });
  }
}
