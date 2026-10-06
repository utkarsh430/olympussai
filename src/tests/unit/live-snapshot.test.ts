import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpstreamFetchResult } from '@/lib/upsrtc/client';
import liveFixture from '@/fixtures/upsrtc-live-sample.json';

vi.mock('@/lib/upsrtc/client', () => ({
  fetchUpstream: vi.fn(),
  UPSRTC_LIVE_URL: 'https://upstream.test/live',
  REQUEST_TIMEOUT_MS: 10_000,
}));

vi.mock('@/lib/upsrtc/fleetFixture', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/upsrtc/fleetFixture')>();
  return { ...actual, loadFleetFixture: vi.fn(actual.loadFleetFixture) };
});

import { fetchUpstream } from '@/lib/upsrtc/client';
import { loadFleetFixture } from '@/lib/upsrtc/fleetFixture';
import {
  LIVE_CACHE_TTL_MS,
  LIVE_RETRY_BACKOFF_MS,
  getLiveSnapshot,
  liveDiagnostics,
  resetLiveSnapshotForTests,
} from '@/lib/upsrtc/liveSnapshot';

const mockFetch = vi.mocked(fetchUpstream);

// The wall clock stands still in this file: the snapshot times an answer from when it
// arrives, and every expected time here assumes it arrives the moment it is asked for.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});
const mockFleet = vi.mocked(loadFleetFixture);
const T0 = 1_800_000_000_000;
const liveFixtureLength = (liveFixture as unknown[]).length;

const okResult = (payload: unknown): UpstreamFetchResult => ({
  ok: true,
  status: 200,
  contentType: 'application/json',
  payload,
});
const failResult: UpstreamFetchResult = {
  ok: false,
  status: 502,
  contentType: 'unknown',
  payload: null,
  error: 'HTTP 502',
};

const LIVE_PAYLOAD = [
  {
    regNum: 'UP78JT4102',
    latitude: 28.36,
    longitude: 79.43,
    speed: 20,
    ignition: 1,
    timestamp: '2026-07-20T07:01:32Z',
    receivedTime: '2026-07-20T07:01:50Z',
    home_depot: '81',
    vehicle_status: 'live',
  },
];

describe('getLiveSnapshot', () => {
  const originalDemo = process.env.NEXT_PUBLIC_DEMO_MODE;

  beforeEach(() => {
    resetLiveSnapshotForTests();
    mockFetch.mockReset();
    mockFleet.mockClear();
    delete process.env.NEXT_PUBLIC_DEMO_MODE;
    // Each change of what is served is logged; the lines are pinned in their own test file.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.mocked(console.error).mockRestore();
    vi.mocked(console.warn).mockRestore();
    if (originalDemo === undefined) delete process.env.NEXT_PUBLIC_DEMO_MODE;
    else process.env.NEXT_PUBLIC_DEMO_MODE = originalDemo;
  });

  it('serves a live snapshot with both projections on a cold cache', async () => {
    mockFetch.mockResolvedValue(okResult(LIVE_PAYLOAD));
    const { snapshot, source, stale } = await getLiveSnapshot(T0);
    expect(source).toBe('live');
    expect(stale).toBe(false);
    expect(snapshot.buses.length).toBeGreaterThan(0);
    expect(snapshot.depotRows.length).toBeGreaterThan(0);
    expect(snapshot.feedNow).toBe('2026-07-20T07:01:50.000Z');
    expect(snapshot.fetchedAt).toBe(new Date(T0).toISOString());
  });

  it('sets the feed clock from the fetch time read in Indian time and counts later rows (S56a)', async () => {
    const ist = (offsetMin: number): string =>
      new Date(T0 + (330 + offsetMin) * 60_000).toISOString().replace('.000Z', 'Z');
    const base = LIVE_PAYLOAD[0]!;
    const payload = [
      { ...base, regNum: 'UP78JT0001', receivedTime: ist(-1) },
      { ...base, regNum: 'UP78JT0002', receivedTime: ist(330) },
    ];
    mockFetch.mockResolvedValue(okResult(payload));
    const { snapshot } = await getLiveSnapshot(T0);
    expect(snapshot.feedNow).toBe(new Date(T0 + 329 * 60_000).toISOString());
    expect(snapshot.feedClockAheadRows).toBe(1);
  });

  it('keeps an old payload on its own clock with nothing counted as ahead', async () => {
    mockFetch.mockResolvedValue(okResult(LIVE_PAYLOAD));
    const { snapshot } = await getLiveSnapshot(T0);
    expect(snapshot.feedClockAheadRows).toBe(0);
  });

  it('serves from cache within the TTL', async () => {
    mockFetch.mockResolvedValue(okResult(LIVE_PAYLOAD));
    const first = await getLiveSnapshot(T0);
    const second = await getLiveSnapshot(T0 + LIVE_CACHE_TTL_MS - 1);
    expect(second.source).toBe('cache');
    expect(second.stale).toBe(false);
    expect(second.snapshot).toBe(first.snapshot);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('fetches again after the TTL', async () => {
    mockFetch.mockResolvedValue(okResult(LIVE_PAYLOAD));
    await getLiveSnapshot(T0);
    await getLiveSnapshot(T0 + LIVE_CACHE_TTL_MS + 1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('shares one upstream call and one snapshot between concurrent callers', async () => {
    let release: (value: UpstreamFetchResult) => void = () => undefined;
    mockFetch.mockReturnValue(
      new Promise<UpstreamFetchResult>((resolve) => {
        release = resolve;
      }),
    );
    const a = getLiveSnapshot(T0);
    const b = getLiveSnapshot(T0 + 5);
    release(okResult(LIVE_PAYLOAD));
    const [resultA, resultB] = await Promise.all([a, b]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(resultA.snapshot).toBe(resultB.snapshot);
  });

  it('falls back to the fixture when upstream fails with no history', async () => {
    mockFetch.mockResolvedValue(failResult);
    const { snapshot, source, stale } = await getLiveSnapshot(T0);
    expect(source).toBe('fixture');
    expect(stale).toBe(true);
    expect(snapshot.depotRows.length).toBeGreaterThan(5_000);
    expect(liveDiagnostics.lastError).toBe('HTTP 502');
  });

  it('serves the last-good snapshot, unchanged, when upstream fails after the TTL', async () => {
    mockFetch.mockResolvedValueOnce(okResult(LIVE_PAYLOAD));
    const first = await getLiveSnapshot(T0);
    mockFetch.mockResolvedValueOnce(failResult);
    const second = await getLiveSnapshot(T0 + LIVE_CACHE_TTL_MS + 1);
    expect(second.source).toBe('cache');
    expect(second.stale).toBe(true);
    expect(second.snapshot).toBe(first.snapshot);
  });

  it('treats zero usable buses as a failure', async () => {
    mockFetch.mockResolvedValue(okResult([]));
    const { source } = await getLiveSnapshot(T0);
    expect(source).toBe('fixture');
    expect(liveDiagnostics.lastError).toBe('Upstream responded but contained no usable bus records');
    expect(liveDiagnostics.consecutiveFailures).toBe(1);
  });

  it('falls to last-good when a later response has zero usable buses', async () => {
    mockFetch.mockResolvedValueOnce(okResult(LIVE_PAYLOAD));
    const first = await getLiveSnapshot(T0);
    mockFetch.mockResolvedValueOnce(okResult([]));
    const second = await getLiveSnapshot(T0 + LIVE_CACHE_TTL_MS + 1);
    expect(second.source).toBe('cache');
    expect(second.snapshot).toBe(first.snapshot);
  });

  it('serves the fixture in demo mode without calling upstream', async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = '1';
    const { snapshot, source, stale } = await getLiveSnapshot(T0);
    expect(source).toBe('fixture');
    expect(stale).toBe(true);
    expect(snapshot.depotRows.length).toBeGreaterThan(5_000);
    expect(snapshot.buses.length).toBeGreaterThan(0);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(liveDiagnostics.lastError).toContain('NEXT_PUBLIC_DEMO_MODE');
  });

  it('does not leave the in-flight slot stuck when the upstream call rejects', async () => {
    mockFetch.mockRejectedValueOnce(new Error('socket hang up'));
    const failed = await getLiveSnapshot(T0);
    expect(failed.source).toBe('fixture');
    expect(liveDiagnostics.lastError).toBe('socket hang up');

    mockFetch.mockResolvedValueOnce(okResult(LIVE_PAYLOAD));
    const recovered = await getLiveSnapshot(T0 + LIVE_RETRY_BACKOFF_MS);
    expect(recovered.source).toBe('live');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('counts consecutive failures and resets them on success', async () => {
    // Each retry comes after the back-off interval: inside it the upstream is not called.
    const retry = (n: number): number => T0 + n * LIVE_RETRY_BACKOFF_MS;
    mockFetch.mockResolvedValue(failResult);
    await getLiveSnapshot(retry(0));
    await getLiveSnapshot(retry(1));
    expect(liveDiagnostics.consecutiveFailures).toBe(2);
    expect(liveDiagnostics.lastStatus).toBe(502);

    mockFetch.mockResolvedValue(okResult(LIVE_PAYLOAD));
    await getLiveSnapshot(retry(2));
    expect(liveDiagnostics.consecutiveFailures).toBe(0);
    expect(liveDiagnostics.lastError).toBeNull();
    expect(liveDiagnostics.lastSuccessAt).toBe(new Date(retry(2)).toISOString());
  });

  describe('concurrent failure', () => {
    function deferred(): {
      promise: Promise<UpstreamFetchResult>;
      resolve: (value: UpstreamFetchResult) => void;
      reject: (reason: Error) => void;
    } {
      let resolve: (value: UpstreamFetchResult) => void = () => undefined;
      let reject: (reason: Error) => void = () => undefined;
      const promise = new Promise<UpstreamFetchResult>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    it('gives joined callers one fixture result when upstream fails', async () => {
      const gate = deferred();
      mockFetch.mockReturnValueOnce(gate.promise);
      const a = getLiveSnapshot(T0);
      const b = getLiveSnapshot(T0 + 1);
      gate.resolve(failResult);
      const [resultA, resultB] = await Promise.all([a, b]);
      expect(resultB).toBe(resultA);
      expect(resultA.source).toBe('fixture');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(liveDiagnostics.consecutiveFailures).toBe(1);

      mockFetch.mockResolvedValueOnce(okResult(LIVE_PAYLOAD));
      await getLiveSnapshot(T0 + LIVE_RETRY_BACKOFF_MS);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('gives joined callers the same last-good result when upstream fails', async () => {
      mockFetch.mockResolvedValueOnce(okResult(LIVE_PAYLOAD));
      const first = await getLiveSnapshot(T0);
      const gate = deferred();
      mockFetch.mockReturnValueOnce(gate.promise);
      const later = T0 + LIVE_CACHE_TTL_MS + 1;
      const a = getLiveSnapshot(later);
      const b = getLiveSnapshot(later + 1);
      gate.resolve(failResult);
      const [resultA, resultB] = await Promise.all([a, b]);
      expect(resultB).toBe(resultA);
      expect(resultA.source).toBe('cache');
      expect(resultA.stale).toBe(true);
      expect(resultA.snapshot).toBe(first.snapshot);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(liveDiagnostics.consecutiveFailures).toBe(1);
    });

    it('gives joined callers one result when the upstream call rejects', async () => {
      const gate = deferred();
      mockFetch.mockReturnValueOnce(gate.promise);
      const a = getLiveSnapshot(T0);
      const b = getLiveSnapshot(T0 + 1);
      gate.reject(new Error('socket hang up'));
      const [resultA, resultB] = await Promise.all([a, b]);
      expect(resultB).toBe(resultA);
      expect(resultA.source).toBe('fixture');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(liveDiagnostics.consecutiveFailures).toBe(1);
      expect(liveDiagnostics.lastError).toBe('socket hang up');

      mockFetch.mockResolvedValueOnce(okResult(LIVE_PAYLOAD));
      const next = await getLiveSnapshot(T0 + LIVE_RETRY_BACKOFF_MS);
      expect(next.source).toBe('live');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  it('ignores an orphaned refresh that finishes after a reset', async () => {
    let release: (value: UpstreamFetchResult) => void = () => undefined;
    mockFetch.mockReturnValueOnce(
      new Promise<UpstreamFetchResult>((resolve) => {
        release = resolve;
      }),
    );
    const orphan = getLiveSnapshot(T0);
    resetLiveSnapshotForTests();
    release(okResult(LIVE_PAYLOAD));
    // Its own caller still gets an answer.
    expect((await orphan).source).toBe('live');

    expect(liveDiagnostics).toEqual({
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastError: null,
      lastStatus: 0,
      consecutiveFailures: 0,
    });
    mockFetch.mockResolvedValueOnce(okResult(LIVE_PAYLOAD));
    const next = await getLiveSnapshot(T0 + 1);
    expect(next.source).toBe('live');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('builds the fixture snapshot from the full-fleet file and says it is a fixture', async () => {
    mockFetch.mockResolvedValue(failResult);
    const { snapshot, source, stale } = await getLiveSnapshot(T0);
    expect(source).toBe('fixture');
    expect(stale).toBe(true);
    expect(snapshot.recordCount).toBe(mockFleet.mock.results[0]?.value.length);
    expect(snapshot.recordCount).toBeGreaterThan(liveFixtureLength);
  });

  it('falls back to the small bundled sample, still as a fixture, when the fleet file is unusable', async () => {
    mockFleet.mockReturnValueOnce(null);
    mockFetch.mockResolvedValue(failResult);
    const { snapshot, source, stale } = await getLiveSnapshot(T0);
    expect(source).toBe('fixture');
    expect(stale).toBe(true);
    expect(snapshot.recordCount).toBe(liveFixtureLength);
    expect(snapshot.depotRows).toHaveLength(liveFixtureLength);
  });

  it('does not touch the fleet file while the feed or the cache answers', async () => {
    mockFleet.mockClear();
    mockFetch.mockResolvedValueOnce(okResult(LIVE_PAYLOAD));
    await getLiveSnapshot(T0);
    await getLiveSnapshot(T0 + 1);
    expect(mockFleet).not.toHaveBeenCalled();
  });

  it('reuses the full-fleet depot rows across fallbacks', async () => {
    mockFetch.mockResolvedValue(failResult);
    const first = await getLiveSnapshot(T0);
    const later = await getLiveSnapshot(T0 + 60_000);
    expect(later.snapshot.depotRows).toBe(first.snapshot.depotRows);
  });

  // P3: a machine clock set before the sample was captured must not make every row "ahead".
  it('keeps the saved sample on its own newest receive time whatever the machine clock', async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = '1';
    const late = await getLiveSnapshot(T0);
    resetLiveSnapshotForTests();
    const early = await getLiveSnapshot(Date.parse('2026-01-01T00:00:00.000Z'));
    expect(early.source).toBe('fixture');
    expect(early.snapshot.feedNow).not.toBeNull();
    expect(early.snapshot.feedNow).toBe(late.snapshot.feedNow);
    expect(early.snapshot.feedClockAheadRows).toBe(0);
    expect(late.snapshot.feedClockAheadRows).toBe(0);
  });

  it('reuses the fixture depot rows across requests and re-stamps only the time', async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = '1';
    const first = await getLiveSnapshot(T0);
    const later = await getLiveSnapshot(T0 + 60_000);
    // Same array, so the depot analysis memoised on it runs once in demo mode.
    expect(later.snapshot.depotRows).toBe(first.snapshot.depotRows);
    expect(later.snapshot.feedNow).toBe(first.snapshot.feedNow);
    expect(first.snapshot.fetchedAt).toBe(new Date(T0).toISOString());
    expect(later.snapshot.fetchedAt).toBe(new Date(T0 + 60_000).toISOString());
    // The map projection is still built per call: its freshness depends on now.
    expect(later.snapshot.buses[0]?.lastUpdatedAt).toBe(new Date(T0 + 60_000).toISOString());

    resetLiveSnapshotForTests();
    const afterReset = await getLiveSnapshot(T0);
    expect(afterReset.snapshot.depotRows).not.toBe(first.snapshot.depotRows);
    expect(afterReset.snapshot.depotRows).toEqual(first.snapshot.depotRows);
  });
});
