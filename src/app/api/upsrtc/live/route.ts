import type { NextRequest } from 'next/server';
import { jsonResponse } from '@/lib/upsrtc/respond';
import { fetchUpstream, UPSRTC_LIVE_URL, REQUEST_TIMEOUT_MS } from '@/lib/upsrtc/client';
import { normalizeLivePayload } from '@/lib/upsrtc/normalizer';
import { TtlCache } from '@/lib/upsrtc/cache';
import liveFixture from '@/fixtures/upsrtc-live-sample.json';
import type { LiveFeedResponse } from '@/models/canonical';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CACHE_TTL_MS = 15_000;
const CACHE_KEY = 'live';

interface CachedLive {
  buses: LiveFeedResponse['buses'];
  recordCount: number;
  rejectedRecordCount: number;
  fetchedAt: string;
}

// Module-scoped: survives across requests in a warm server process.
const cache = new TtlCache<CachedLive>(CACHE_TTL_MS);

/** Diagnostics snapshot, surfaced via the developer drawer. */
export const liveDiagnostics = {
  lastAttemptAt: null as string | null,
  lastSuccessAt: null as string | null,
  lastError: null as string | null,
  lastStatus: 0,
  consecutiveFailures: 0,
};

function fixtureResponse(reason: string): LiveFeedResponse {
  const { buses, recordCount, rejectedRecordCount } = normalizeLivePayload(liveFixture);
  liveDiagnostics.lastError = reason;
  return {
    buses,
    fetchedAt: new Date().toISOString(),
    source: 'fixture',
    stale: true,
    recordCount,
    rejectedRecordCount,
  };
}

export async function GET(request: NextRequest): Promise<Response> {
  const acceptEncoding = request.headers.get('accept-encoding');
  const now = Date.now();

  // Explicit offline demo mode for presentations without connectivity.
  if (process.env.NEXT_PUBLIC_DEMO_MODE === '1') {
    return jsonResponse(fixtureResponse('Fixture mode forced via NEXT_PUBLIC_DEMO_MODE'), { acceptEncoding });
  }

  const cached = cache.get(CACHE_KEY, now);
  if (cached) {
    const body: LiveFeedResponse = { ...cached, source: 'cache', stale: false };
    return jsonResponse(body, { acceptEncoding });
  }

  liveDiagnostics.lastAttemptAt = new Date(now).toISOString();
  const result = await fetchUpstream(UPSRTC_LIVE_URL, REQUEST_TIMEOUT_MS);
  liveDiagnostics.lastStatus = result.status;

  if (result.ok) {
    const { buses, recordCount, rejectedRecordCount } = normalizeLivePayload(result.payload, now);

    if (buses.length > 0) {
      const entry: CachedLive = {
        buses,
        recordCount,
        rejectedRecordCount,
        fetchedAt: new Date(now).toISOString(),
      };
      cache.set(CACHE_KEY, entry, now);
      liveDiagnostics.lastSuccessAt = entry.fetchedAt;
      liveDiagnostics.lastError = null;
      liveDiagnostics.consecutiveFailures = 0;

      const body: LiveFeedResponse = { ...entry, source: 'live', stale: false };
      return jsonResponse(body, { acceptEncoding });
    }

    liveDiagnostics.lastError = 'Upstream responded but contained no usable bus records';
  } else {
    liveDiagnostics.lastError = result.error ?? 'Unknown upstream failure';
  }

  liveDiagnostics.consecutiveFailures += 1;

  // Degrade gracefully: last-known-good, then fixture. Never a blank screen.
  const lastGood = cache.getLastGood(CACHE_KEY);
  if (lastGood) {
    const body: LiveFeedResponse = {
      ...lastGood.value,
      source: 'cache',
      stale: true,
    };
    return jsonResponse(body, { acceptEncoding });
  }

  return jsonResponse(fixtureResponse(liveDiagnostics.lastError ?? 'Upstream unavailable'), { acceptEncoding });
}
