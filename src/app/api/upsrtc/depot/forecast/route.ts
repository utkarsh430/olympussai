import type { NextRequest } from 'next/server';
import { jsonResponse } from '@/lib/upsrtc/respond';
import { requireUpsrtcAccess, unauthorizedResponse } from '@/lib/auth/authorize';
import { getRepositories } from '@/lib/depot/repositories';
import { buildForecastResponse, parseForecastQuery } from '@/lib/depot/live/forecastView';
import { logDepotError } from '@/lib/serverLog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** One metric's modelled history, trend and forecast, ending on the live value. */
export async function GET(request: NextRequest): Promise<Response> {
  // Independent authorization check — never rely on middleware alone.
  const session = await requireUpsrtcAccess();
  if (!session) return unauthorizedResponse();

  // A malformed query is refused before any snapshot is read.
  const parsed = parseForecastQuery(request.nextUrl.searchParams);
  if (!parsed.ok) return jsonResponse({ error: 'Invalid query' }, { status: 400 });

  const acceptEncoding = request.headers.get('accept-encoding');
  try {
    const view = await getRepositories().fleet.snapshot();
    const { status, body } = await buildForecastResponse(view, parsed.query);
    return jsonResponse(body, { status, acceptEncoding });
  } catch (error) {
    // The upstream message can name hosts or carry tokens; it is logged, never returned.
    logDepotError('forecast-api', error);
    return jsonResponse({ error: 'Depot data unavailable' }, { status: 503 });
  }
}
