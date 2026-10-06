import { fetchUpstream, UPSRTC_LIVE_URL, REQUEST_TIMEOUT_MS } from '@/lib/upsrtc/client';
import type { UpstreamFetchResult } from '@/lib/upsrtc/client';
import { normalizeLivePayload } from '@/lib/upsrtc/normalizer';
import { deriveFeedClock, normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';
import { TtlCache } from '@/lib/upsrtc/cache';
import { logDepotError, logDepotNotice } from '@/lib/serverLog';
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
   * The feed clock: the newest upstream `receivedAt` not later
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
/**
 * A reply with fewer depot rows than this share of the last good reply's is a failed
 * refresh: a cut-off or partial answer would otherwise be served as live and offered to the
 * score window and the yard memory as a real sample, with every depot's fleet near zero.
 * Safe at night: the feed lists every registered vehicle on every answer, with its last
 * known record and a status (live, stationary, no signal, under maintenance), whether or
 * not it is reporting; the saved full-fleet sample holds rows last heard two weeks before
 * it was taken. So the row count follows the size of the fleet, not the hour: buses
 * parked for the night stay in the list, and only a cut-off reply falls below half.
 */
export const MIN_ROWS_SHARE_OF_LAST_GOOD = 0.5;
/**
 * After this many short replies in a row the shorter list is taken as the fleet's real
 * size, so a lasting change upstream cannot hold the chain on old data for ever.
 */
export const SHORT_REPLIES_BEFORE_ACCEPTED = 3;
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
// Bumped by the test reset so a refresh started before it cannot write afterwards.
let generation = 0;
// Until this wall time, a failed refresh is not retried; null while the upstream answers.
let retryAfterMs: number | null = null;
// Short replies refused in a row (see SHORT_REPLIES_BEFORE_ACCEPTED).
let shortReplies = 0;

/*
 * What the chain is serving, so that each change is logged once with its reason and never
 * once per request: live → last-good or the saved sample when a refresh fails (or demo mode
 * is on), last-good → the saved sample if last-good is ever gone, and back to live on
 * recovery. The reason never carries an address, which may hold credentials.
 */
type ServingFrom = 'live' | 'last-good' | 'sample';
const SERVING_WORDS: Readonly<Record<ServingFrom, string>> = {
  live: 'live data',
  'last-good': 'last good data',
  sample: 'the saved sample',
};
const LOG_SCOPE = 'live-snapshot';
const ADDRESS_PATTERN = /[a-z][a-z0-9+.-]*:\/\/\S+/gi;
let servingFrom: ServingFrom = 'live';

function noteServing(next: ServingFrom, reason: string): void {
  if (next === servingFrom) return;
  const previous = servingFrom;
  servingFrom = next;
  if (next === 'live') {
    const was = SERVING_WORDS[previous];
    logDepotNotice(LOG_SCOPE, `upstream recovered; serving live data again instead of ${was}`);
    return;
  }
  const safeReason = reason.replace(ADDRESS_PATTERN, '(address withheld)');
  const change = `serving ${SERVING_WORDS[next]} instead of ${SERVING_WORDS[previous]}`;
  logDepotError(LOG_SCOPE, `${change}: ${safeReason}`);
}

function noteFallback(result: LiveSnapshotResult, reason: string): LiveSnapshotResult {
  noteServing(result.source === 'fixture' ? 'sample' : 'last-good', reason);
  return result;
}

interface DepotProjection {
  readonly rows: readonly DepotBusRow[];
  readonly feedNow: string | null;
  readonly feedClockAheadRows: number;
}

/**
 * The depot projection depends on the payload and the fetch time only: the
 * fetch bounds how far ahead a receive time may set the feed clock.
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
 * map projection's `lastUpdatedAt` and `dataQuality` depend on `now`, so it is
 * built per call, but only when a caller reads `buses`: the depot routes never
 * do. Its counts depend on the payload alone and are taken once. Either way the
 * result is reported as the `fixture` source, so the pages can say the data is
 * a saved sample.
 */
interface FixtureProjection {
  readonly payload: unknown;
  readonly depot: DepotProjection;
  readonly recordCount: number;
  readonly rejectedRecordCount: number;
}

let fixture: FixtureProjection | null = null;

function loadFixture(): FixtureProjection {
  const payload: unknown = loadFleetFixture() ?? liveFixture;
  const counts = normalizeLivePayload(payload, 0);
  return {
    payload,
    // No upper limit: the sample's clock is its own newest receive time, never "ahead"
    // of this machine's clock, which may even be set before the sample was captured.
    depot: projectDepot(payload, Number.POSITIVE_INFINITY),
    recordCount: counts.recordCount,
    rejectedRecordCount: counts.rejectedRecordCount,
  };
}

function fixtureResult(now: number): LiveSnapshotResult {
  fixture ??= loadFixture();
  const { payload, depot, recordCount, rejectedRecordCount } = fixture;
  let buses: readonly CanonicalLiveBus[] | null = null;
  const snapshot: LiveSnapshot = {
    get buses(): readonly CanonicalLiveBus[] {
      buses ??= normalizeLivePayload(payload, now).buses;
      return buses;
    },
    depotRows: depot.rows,
    recordCount,
    rejectedRecordCount,
    fetchedAt: new Date(now).toISOString(),
    feedNow: depot.feedNow,
    feedClockAheadRows: depot.feedClockAheadRows,
  };
  return { snapshot, source: 'fixture', stale: true };
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

async function refresh(startedAt: number): Promise<LiveSnapshotResult> {
  const startedIn = generation;
  // A test reset during the fetch orphans this refresh: it still answers its own
  // callers but must not touch the cache or diagnostics the reset just cleared.
  const isCurrent = (): boolean => generation === startedIn;

  liveDiagnostics.lastAttemptAt = new Date(startedAt).toISOString();
  const wallAtStart = Date.now();
  const result = await safeFetch();
  // Everything after this is timed from when the answer arrived, not from when the first
  // caller asked: a slow answer would otherwise start part-way through its TTL, read older
  // than it is ("received … ago"), and cut short the back-off and the last-good grace.
  const now = startedAt + Math.max(0, Date.now() - wallAtStart);
  if (isCurrent()) liveDiagnostics.lastStatus = result.status;

  let failure: string;
  if (result.ok) {
    const snapshot = buildSnapshot(result.payload, now);
    const verdict = judgeReply(snapshot);
    if (isCurrent()) shortReplies = verdict.short ? shortReplies + 1 : 0;
    if (verdict.reason === null) {
      if (isCurrent()) {
        cache.set(CACHE_KEY, snapshot, now);
        liveDiagnostics.lastSuccessAt = snapshot.fetchedAt;
        liveDiagnostics.lastError = null;
        liveDiagnostics.consecutiveFailures = 0;
        retryAfterMs = null;
        noteServing('live', '');
      }
      return { snapshot, source: 'live', stale: false };
    }
    failure = verdict.reason;
  } else {
    failure = result.error ?? 'Unknown upstream failure';
  }

  if (isCurrent()) {
    liveDiagnostics.lastError = failure;
    liveDiagnostics.consecutiveFailures += 1;
    retryAfterMs = now + LIVE_RETRY_BACKOFF_MS;
    return noteFallback(fallbackResult(now), `upstream refresh failed (${failure})`);
  }
  return fallbackResult(now);
}

interface ReplyVerdict {
  /** Why the reply is refused, or null when it is served as live. */
  readonly reason: string | null;
  /** Refused for being short (counted towards SHORT_REPLIES_BEFORE_ACCEPTED). */
  readonly short: boolean;
}

/**
 * The map projection must hold at least one bus (the command centre never receives an
 * empty live list), and the depot rows at least MIN_ROWS_SHARE_OF_LAST_GOOD of last-good's.
 */
function judgeReply(snapshot: LiveSnapshot): ReplyVerdict {
  if (snapshot.buses.length === 0) {
    return { reason: 'Upstream responded but contained no usable bus records', short: false };
  }
  const lastGood = cache.getLastGood(CACHE_KEY)?.value;
  const rows = snapshot.depotRows.length;
  const goodRows = lastGood?.depotRows.length ?? 0;
  if (rows >= goodRows * MIN_ROWS_SHARE_OF_LAST_GOOD) return { reason: null, short: false };
  if (shortReplies + 1 >= SHORT_REPLIES_BEFORE_ACCEPTED) return { reason: null, short: false };
  const reason = `Upstream reply had ${rows} bus rows against ${goodRows} in the last good reply`;
  return { reason, short: true };
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
    return Promise.resolve(noteFallback(fixtureResult(now), 'demo mode is on'));
  }

  const cached = cache.get(CACHE_KEY, now);
  if (cached) return Promise.resolve({ snapshot: cached, source: 'cache', stale: false });

  // Backing off after a failure: answer as the failed refresh did, without the upstream.
  if (retryAfterMs !== null && now < retryAfterMs) {
    const reason = `upstream refresh failed (${liveDiagnostics.lastError ?? 'unknown'})`;
    return Promise.resolve(noteFallback(fallbackResult(now), reason));
  }

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
  shortReplies = 0;
  servingFrom = 'live';
  generation += 1;
  fixture = null;
  resetFleetFixtureForTests();
  Object.assign(liveDiagnostics, INITIAL_DIAGNOSTICS);
}
