import { fetchUpstream, UPSRTC_LIVE_URL, REQUEST_TIMEOUT_MS } from '@/lib/upsrtc/client';
import type { UpstreamFetchResult } from '@/lib/upsrtc/client';
import { normalizeLivePayload } from '@/lib/upsrtc/normalizer';
import { deriveFeedClock, normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';
import { TtlCache } from '@/lib/upsrtc/cache';
import { logDepotError } from '@/lib/depot/log';
import { loadFleetFixture, resetFleetFixtureForTests } from '@/lib/upsrtc/fleetFixture';
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
  readonly buses: readonly CanonicalLiveBus[];
  readonly depotRows: readonly DepotBusRow[];
  readonly recordCount: number;
  readonly rejectedRecordCount: number;
  /** Server ISO time the snapshot was built. */
  readonly fetchedAt: string;
  /**
   * The feed clock (ruling S56a): the newest upstream `receivedAt` not later
   * than the fetch time read in Indian time plus FEED_CLOCK_MAX_LEAD_MIN.
   */
  readonly feedNow: string | null;
  /**
   * Depot rows stamped later than that, ignored for the clock. Above zero, the
   * feed sent future stamps or this server's clock is slow (the clock then
   * lags). Optional only for older literals; always set here.
   */
  readonly feedClockAheadRows?: number;
}

export interface LiveSnapshotResult {
  readonly snapshot: LiveSnapshot;
  readonly source: UpstreamSource;
  readonly stale: boolean;
}

export const LIVE_CACHE_TTL_MS = 15_000;
/**
 * After a failed refresh, how long the upstream is left alone: inside this interval every
 * request is answered at once with what the failed refresh answered (last-good data, or
 * the saved sample when there is none) instead of waiting up to REQUEST_TIMEOUT_MS on an
 * upstream that has just failed. The first request after it tries the upstream again.
 */
export const LIVE_RETRY_BACKOFF_MS = 20_000;
const CACHE_KEY = 'live';

/** How a caller may be answered while the cached snapshot is older than its TTL. */
export interface LiveSnapshotOptions {
  /**
   * Answer at once with last-good data up to this age, and refresh in the background
   * (one refresh shared by every caller). Without it the caller waits for the refresh,
   * as the command centre's route does.
   */
  readonly serveLastGoodWithinMs?: number;
}

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

/**
 * Diagnostics snapshot, surfaced via the developer drawer.
 *
 * Behaviour change from the pre-snapshot route: diagnostics advance once per
 * upstream fetch, not once per request, so N concurrent failing requests that
 * share one fetch count as a single failure.
 */
export const liveDiagnostics: LiveDiagnostics = { ...INITIAL_DIAGNOSTICS };

// Module-scoped: survives across requests in a warm server process.
const cache = new TtlCache<LiveSnapshot>(LIVE_CACHE_TTL_MS);
let inFlight: Promise<LiveSnapshotResult> | null = null;
// Until this wall time, a failed refresh is not retried; null while the upstream answers.
let retryAfterMs: number | null = null;
// Bumped by the test reset so a refresh started before it cannot write afterwards.
let generation = 0;

interface DepotProjection {
  readonly rows: readonly DepotBusRow[];
  readonly feedNow: string | null;
  readonly feedClockAheadRows: number;
}

/**
 * The depot projection depends on the payload and the fetch time only: the
 * fetch bounds how far ahead a receive time may set the feed clock (S56a).
 */
function projectDepot(payload: unknown, fetchedAtMs: number): DepotProjection {
  const rows = normalizeDepotRows(payload).rows;
  const clock = deriveFeedClock(rows, fetchedAtMs);
  return { rows, feedNow: clock.feedNow, feedClockAheadRows: clock.aheadRows };
}

/** Both projections from one payload, so they can never describe different fetches. */
function buildSnapshot(
  payload: unknown,
  now: number,
  depot: DepotProjection = projectDepot(payload, now),
): LiveSnapshot {
  const live = normalizeLivePayload(payload, now);
  return {
    buses: live.buses,
    depotRows: depot.rows,
    recordCount: live.recordCount,
    rejectedRecordCount: live.rejectedRecordCount,
    fetchedAt: new Date(now).toISOString(),
    feedNow: depot.feedNow,
    feedClockAheadRows: depot.feedClockAheadRows,
  };
}

/*
 * The fixture never changes, so its payload is chosen and its depot projection
 * built once per process and the same rows array is reused: depot views
 * memoise on that identity, so demo mode and an outage with no history no
 * longer re-run the analysis per request. The payload is the full-fleet file
 * when it loads (read lazily, only here), else the small bundled sample. The
 * map projection is still built per call, because its `lastUpdatedAt` and
 * `dataQuality` depend on `now`. Either way the result is reported as the
 * `fixture` source, so the pages can say the data is a saved sample.
 */
interface FixtureProjection {
  readonly payload: unknown;
  readonly depot: DepotProjection;
}

let fixture: FixtureProjection | null = null;

function fixtureResult(now: number): LiveSnapshotResult {
  if (!fixture) {
    const payload: unknown = loadFleetFixture() ?? liveFixture;
    // No upper limit (P3): the sample's clock is its own newest receive time, never "ahead"
    // of this machine's clock, which may even be set before the sample was captured.
    fixture = { payload, depot: projectDepot(payload, Number.POSITIVE_INFINITY) };
  }
  return {
    snapshot: buildSnapshot(fixture.payload, now, fixture.depot),
    source: 'fixture',
    stale: true,
  };
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
  const startedIn = generation;
  // A test reset during the fetch orphans this refresh: it still answers its own
  // callers but must not touch the cache or diagnostics the reset just cleared.
  const isCurrent = (): boolean => generation === startedIn;

  liveDiagnostics.lastAttemptAt = new Date(now).toISOString();
  const result = await safeFetch();
  if (isCurrent()) liveDiagnostics.lastStatus = result.status;

  let failure: string;
  if (result.ok) {
    const snapshot = buildSnapshot(result.payload, now);
    if (snapshot.buses.length > 0) {
      if (isCurrent()) {
        cache.set(CACHE_KEY, snapshot, now);
        liveDiagnostics.lastSuccessAt = snapshot.fetchedAt;
        liveDiagnostics.lastError = null;
        liveDiagnostics.consecutiveFailures = 0;
        retryAfterMs = null;
      }
      return { snapshot, source: 'live', stale: false };
    }
    failure = 'Upstream responded but contained no usable bus records';
  } else {
    failure = result.error ?? 'Unknown upstream failure';
  }

  if (isCurrent()) {
    liveDiagnostics.lastError = failure;
    liveDiagnostics.consecutiveFailures += 1;
    retryAfterMs = now + LIVE_RETRY_BACKOFF_MS;
  }
  return fallbackResult(now);
}

/** Degrade gracefully: last-known-good, then the saved sample. Never a blank screen. */
function fallbackResult(now: number): LiveSnapshotResult {
  const lastGood = cache.getLastGood(CACHE_KEY);
  if (lastGood) return { snapshot: lastGood.value, source: 'cache', stale: true };
  return fixtureResult(now);
}

/** Single-flight: concurrent callers share one upstream request and one result. */
function sharedRefresh(now: number): Promise<LiveSnapshotResult> {
  if (inFlight) return inFlight;
  const pending: Promise<LiveSnapshotResult> = refresh(now).finally(() => {
    // Only release our own slot; a test reset may already have replaced it.
    if (inFlight === pending) inFlight = null;
  });
  // A refresh nobody waits on (a background one) must not end as an unhandled rejection;
  // callers that do wait still receive the rejection from `pending` itself.
  pending.catch((error: unknown) => logDepotError('live-snapshot', error));
  inFlight = pending;
  return pending;
}

/** Last-good data no older than `maxAgeMs`, or null. A negative age is not young. */
function youngLastGood(now: number, maxAgeMs: number | undefined): LiveSnapshot | null {
  if (maxAgeMs === undefined) return null;
  const lastGood = cache.getLastGood(CACHE_KEY);
  if (!lastGood) return null;
  const ageMs = now - lastGood.storedAt;
  return ageMs >= 0 && ageMs <= maxAgeMs ? lastGood.value : null;
}

export function getLiveSnapshot(
  now: number = Date.now(),
  options: LiveSnapshotOptions = {},
): Promise<LiveSnapshotResult> {
  // Explicit offline demo mode for presentations without connectivity.
  if (process.env.NEXT_PUBLIC_DEMO_MODE === '1') {
    liveDiagnostics.lastError = 'Fixture mode forced via NEXT_PUBLIC_DEMO_MODE';
    return Promise.resolve(fixtureResult(now));
  }

  const cached = cache.get(CACHE_KEY, now);
  if (cached) return Promise.resolve({ snapshot: cached, source: 'cache', stale: false });

  // Backing off after a failure: answer as the failed refresh did, without the upstream.
  if (retryAfterMs !== null && now < retryAfterMs) return Promise.resolve(fallbackResult(now));

  const refreshing = sharedRefresh(now);
  // Stale-while-revalidate for callers that accept it: the refresh above runs on regardless.
  // Flagged stale like any last-good answer; the caller judges freshness by the data's age.
  const young = youngLastGood(now, options.serveLastGoodWithinMs);
  if (young) return Promise.resolve({ snapshot: young, source: 'cache', stale: true });
  return refreshing;
}

/** Test seam: drop the cache, any in-flight fetch, the fixture projection and the diagnostics. */
export function resetLiveSnapshotForTests(): void {
  cache.clear();
  inFlight = null;
  retryAfterMs = null;
  generation += 1;
  fixture = null;
  resetFleetFixtureForTests();
  Object.assign(liveDiagnostics, INITIAL_DIAGNOSTICS);
}
