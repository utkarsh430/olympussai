import type { NextRequest } from 'next/server';
import { jsonResponse } from '@/lib/upsrtc/respond';
import { requireUpsrtcAccess } from '@/lib/auth/authorize';
import { fetchUpstream, UPSRTC_LIVE_URL, REQUEST_TIMEOUT_MS } from '@/lib/upsrtc/client';
import { normalizeLivePayload } from '@/lib/upsrtc/normalizer';
import { TtlCache } from '@/lib/upsrtc/cache';
import { isDemoModeForced, isFixtureFallbackAllowed } from '@/lib/upsrtc/fixtureFallback';
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
    message: `Showing bundled UPSRTC fixture data — these vehicles are not real. (${reason})`,
  };
}

/**
 * The honest answer when the upstream could not be reached and no real cached
 * response is held: zero vehicles, explicitly flagged. Never fixture rows —
 * substituting demo buses for an outage is exactly what this state exists to
 * stop (src/lib/upsrtc/fixtureFallback.ts).
 */
function unavailableResponse(reason: string): LiveFeedResponse {
  return {
    buses: [],
    fetchedAt: new Date().toISOString(),
    source: 'unavailable',
    stale: true,
    recordCount: 0,
    rejectedRecordCount: 0,
    message: `Live UPSRTC feed is unavailable — the upstream did not answer and no cached response is held. (${reason})`,
  };
}

/** Fixture substitution only where explicitly permitted; otherwise the unavailable state. */
function degradedResponse(reason: string): LiveFeedResponse {
  return isFixtureFallbackAllowed() ? fixtureResponse(reason) : unavailableResponse(reason);
}

export async function GET(request: NextRequest): Promise<Response> {
  // Independent authorization check — never rely on middleware alone, which
  // runs on the Edge and cannot read `ops_users`. This answers the whole
  // fleet's live positions, so "signed in" was never the right question.
  const guard = await requireUpsrtcAccess();
  if (!guard.ok) return guard.response;

  const acceptEncoding = request.headers.get('accept-encoding');
  const now = Date.now();

  // Explicit offline demo mode for presentations without connectivity.
  if (isDemoModeForced()) {
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

    // The upstream answered and carried nothing at all: a real, healthy "no
    // vehicles on the road" reading, not a failure — and emphatically not the
    // same thing as an unreachable upstream, which is why it keeps `source:
    // 'live'` and clears the error rather than falling down the ladder.
    if (recordCount === 0) {
      liveDiagnostics.lastSuccessAt = new Date(now).toISOString();
      liveDiagnostics.lastError = null;
      liveDiagnostics.consecutiveFailures = 0;

      const body: LiveFeedResponse = {
        buses: [],
        fetchedAt: new Date(now).toISOString(),
        source: 'live',
        stale: false,
        recordCount: 0,
        rejectedRecordCount,
        message: 'The UPSRTC upstream answered normally and reported no vehicles on the road.',
      };
      return jsonResponse(body, { acceptEncoding });
    }

    // Records arrived but every one was rejected as unusable — the feed is
    // answering with data we cannot trust, which is a degradation.
    liveDiagnostics.lastError = 'Upstream responded but contained no usable bus records';
  } else {
    liveDiagnostics.lastError = result.error ?? 'Unknown upstream failure';
  }

  liveDiagnostics.consecutiveFailures += 1;

  // Degrade gracefully: last-known-good real data, then an explicit
  // unavailable state. The bundled fixture only enters this ladder when it
  // has been asked for (src/lib/upsrtc/fixtureFallback.ts) — an outage must
  // not silently repopulate the map with vehicles that do not exist.
  const lastGood = cache.getLastGood(CACHE_KEY);
  if (lastGood) {
    const body: LiveFeedResponse = {
      ...lastGood.value,
      source: 'cache',
      stale: true,
    };
    return jsonResponse(body, { acceptEncoding });
  }

  return jsonResponse(degradedResponse(liveDiagnostics.lastError ?? 'Upstream unavailable'), { acceptEncoding });
}
