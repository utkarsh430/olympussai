import { fetchUpstream, UPSRTC_LIVE_URL, REQUEST_TIMEOUT_MS } from '@/lib/upsrtc/client';
import type { UpstreamFetchResult } from '@/lib/upsrtc/client';
import { normalizeLivePayload } from '@/lib/upsrtc/normalizer';
import { deriveFeedNow, normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';
import { TtlCache } from '@/lib/upsrtc/cache';
import liveFixture from '@/fixtures/upsrtc-live-sample.json';
import type { CanonicalLiveBus, UpstreamSource } from '@/models/canonical';
import type { DepotBusRow } from '@/models/depotLive';

/**
 * The one upstream fetch every live figure is computed from.
 *
 * The map route and the depot module read the same snapshot, so a depot count
 * and a map pin can never disagree because they were fetched a few seconds
 * apart. Both projections are built from a single payload and cached together.
 */

export interface LiveSnapshot {
  readonly buses: CanonicalLiveBus[];
  readonly depotRows: DepotBusRow[];
  readonly recordCount: number;
  readonly rejectedRecordCount: number;
  /** Server ISO time the snapshot was built. */
  readonly fetchedAt: string;
  /** Newest upstream `receivedAt` across the depot rows. */
  readonly feedNow: string | null;
}

export interface LiveSnapshotResult {
  readonly snapshot: LiveSnapshot;
  readonly source: UpstreamSource;
  readonly stale: boolean;
}

export const LIVE_CACHE_TTL_MS = 15_000;
const CACHE_KEY = 'live';

interface LiveDiagnostics {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastStatus: number;
  consecutiveFailures: number;
}

const INITIAL_DIAGNOSTICS: Readonly<LiveDiagnostics> = {
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null,
  lastStatus: 0,
  consecutiveFailures: 0,
};

/** Diagnostics snapshot, surfaced via the developer drawer. */
export const liveDiagnostics: LiveDiagnostics = { ...INITIAL_DIAGNOSTICS };

// Module-scoped: survives across requests in a warm server process.
const cache = new TtlCache<LiveSnapshot>(LIVE_CACHE_TTL_MS);
let inFlight: Promise<LiveSnapshotResult> | null = null;

/** Both projections from one payload, so they can never describe different fetches. */
function buildSnapshot(payload: unknown, now: number): LiveSnapshot {
  const live = normalizeLivePayload(payload, now);
  const depot = normalizeDepotRows(payload);
  return {
    buses: live.buses,
    depotRows: depot.rows,
    recordCount: live.recordCount,
    rejectedRecordCount: live.rejectedRecordCount,
    fetchedAt: new Date(now).toISOString(),
    feedNow: deriveFeedNow(depot.rows),
  };
}

function fixtureResult(reason: string, now: number): LiveSnapshotResult {
  liveDiagnostics.lastError = reason;
  return { snapshot: buildSnapshot(liveFixture, now), source: 'fixture', stale: true };
}

async function safeFetch(): Promise<UpstreamFetchResult> {
  try {
    return await fetchUpstream(UPSRTC_LIVE_URL, REQUEST_TIMEOUT_MS);
  } catch (error) {
    // fetchUpstream reports failures as values; this guards a contract break so
    // the caller still degrades to last-good or the fixture.
    const message = error instanceof Error ? error.message : 'Unknown upstream error';
    return { ok: false, status: 0, contentType: 'unknown', payload: null, error: message };
  }
}

async function refresh(now: number): Promise<LiveSnapshotResult> {
  liveDiagnostics.lastAttemptAt = new Date(now).toISOString();
  const result = await safeFetch();
  liveDiagnostics.lastStatus = result.status;

  if (result.ok) {
    const snapshot = buildSnapshot(result.payload, now);
    if (snapshot.buses.length > 0) {
      cache.set(CACHE_KEY, snapshot, now);
      liveDiagnostics.lastSuccessAt = snapshot.fetchedAt;
      liveDiagnostics.lastError = null;
      liveDiagnostics.consecutiveFailures = 0;
      return { snapshot, source: 'live', stale: false };
    }
    liveDiagnostics.lastError = 'Upstream responded but contained no usable bus records';
  } else {
    liveDiagnostics.lastError = result.error ?? 'Unknown upstream failure';
  }

  liveDiagnostics.consecutiveFailures += 1;

  // Degrade gracefully: last-known-good, then fixture. Never a blank screen.
  const lastGood = cache.getLastGood(CACHE_KEY);
  if (lastGood) return { snapshot: lastGood.value, source: 'cache', stale: true };
  return fixtureResult(liveDiagnostics.lastError ?? 'Upstream unavailable', now);
}

export function getLiveSnapshot(now: number = Date.now()): Promise<LiveSnapshotResult> {
  // Explicit offline demo mode for presentations without connectivity.
  if (process.env.NEXT_PUBLIC_DEMO_MODE === '1') {
    return Promise.resolve(fixtureResult('Fixture mode forced via NEXT_PUBLIC_DEMO_MODE', now));
  }

  const cached = cache.get(CACHE_KEY, now);
  if (cached) return Promise.resolve({ snapshot: cached, source: 'cache', stale: false });

  // Single-flight: concurrent callers share one upstream request and one result.
  if (inFlight) return inFlight;

  const pending: Promise<LiveSnapshotResult> = refresh(now).finally(() => {
    // Only release our own slot; a test reset may already have replaced it.
    if (inFlight === pending) inFlight = null;
  });
  inFlight = pending;
  return pending;
}

/** Test seam: drop the cache, any in-flight fetch and the diagnostics. */
export function resetLiveSnapshotForTests(): void {
  cache.clear();
  inFlight = null;
  Object.assign(liveDiagnostics, INITIAL_DIAGNOSTICS);
}
