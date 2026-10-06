import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpstreamFetchResult } from '@/lib/upsrtc/client';

vi.mock('@/lib/upsrtc/client', () => ({
  fetchUpstream: vi.fn(),
  UPSRTC_LIVE_URL: 'https://upstream.test/live',
  REQUEST_TIMEOUT_MS: 10_000,
}));

import { fetchUpstream } from '@/lib/upsrtc/client';
import {
  LIVE_CACHE_TTL_MS,
  LIVE_RETRY_BACKOFF_MS,
  MIN_ROWS_SHARE_OF_LAST_GOOD,
  SHORT_REPLIES_BEFORE_ACCEPTED,
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
const T0 = 1_800_000_000_000;
const DEPOT = { serveLastGoodWithinMs: 90_000 } as const;

const okResult = (payload: unknown): UpstreamFetchResult => ({
  ok: true,
  status: 200,
  contentType: 'application/json',
  payload,
});
const failResult: UpstreamFetchResult = {
  ok: false,
  status: 0,
  contentType: 'unknown',
  payload: null,
  error: 'Upstream timed out after 10000ms',
};

function payload(regNum: string): unknown[] {
  return [
    {
      regNum,
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
}

function gate(): { promise: Promise<UpstreamFetchResult>; open: (r: UpstreamFetchResult) => void } {
  let open: (r: UpstreamFetchResult) => void = () => undefined;
  const promise = new Promise<UpstreamFetchResult>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

describe('live snapshot after a failed refresh', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    resetLiveSnapshotForTests();
    mockFetch.mockReset();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('answers last-good at once, without the upstream, inside the back-off interval', async () => {
    mockFetch.mockResolvedValueOnce(okResult(payload('UP78JT4102')));
    const first = await getLiveSnapshot(T0);
    mockFetch.mockResolvedValueOnce(failResult);
    const failedAt = T0 + LIVE_CACHE_TTL_MS + 1;
    const failed = await getLiveSnapshot(failedAt);

    const during = await getLiveSnapshot(failedAt + LIVE_RETRY_BACKOFF_MS - 1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    // Exactly what the failed refresh answered: same data, same source and flag.
    expect(during).toEqual(failed);
    expect(during.snapshot).toBe(first.snapshot);
    expect(during.source).toBe('cache');
    expect(during.stale).toBe(true);
  });

  it('answers the saved sample at once inside the back-off when there is no last-good', async () => {
    mockFetch.mockResolvedValue(failResult);
    const failed = await getLiveSnapshot(T0);
    const during = await getLiveSnapshot(T0 + 1_000);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(during.source).toBe('fixture');
    expect(during.stale).toBe(true);
    expect(during.snapshot.depotRows).toBe(failed.snapshot.depotRows);
  });

  it('tries the upstream again once the back-off interval has passed', async () => {
    mockFetch.mockResolvedValueOnce(failResult);
    await getLiveSnapshot(T0);
    mockFetch.mockResolvedValueOnce(okResult(payload('UP78JT4102')));
    const recovered = await getLiveSnapshot(T0 + LIVE_RETRY_BACKOFF_MS);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(recovered.source).toBe('live');
    // A success ends the back-off: the next miss after the TTL calls the upstream again.
    mockFetch.mockResolvedValueOnce(okResult(payload('UP78JT4102')));
    await getLiveSnapshot(T0 + LIVE_RETRY_BACKOFF_MS + LIVE_CACHE_TTL_MS + 1);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});

describe('live snapshot for a caller that accepts young last-good data', () => {
  beforeEach(() => {
    resetLiveSnapshotForTests();
    mockFetch.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('answers young last-good at once and refreshes once in the background', async () => {
    mockFetch.mockResolvedValueOnce(okResult(payload('UP78JT4102')));
    const first = await getLiveSnapshot(T0);
    const upstream = gate();
    mockFetch.mockReturnValueOnce(upstream.promise);
    const later = T0 + LIVE_CACHE_TTL_MS + 1;

    const a = await getLiveSnapshot(later, DEPOT);
    const b = await getLiveSnapshot(later + 5, DEPOT);
    expect(a.snapshot).toBe(first.snapshot);
    expect(b.snapshot).toBe(first.snapshot);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    upstream.open(okResult(payload('UP78JT9999')));
    await vi.waitFor(async () => {
      const next = await getLiveSnapshot(later + 10, DEPOT);
      expect(next.snapshot.depotRows[0]?.registrationNumber).toBe('UP78JT9999');
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('waits for the refresh when last-good is older than the limit', async () => {
    mockFetch.mockResolvedValueOnce(okResult(payload('UP78JT4102')));
    await getLiveSnapshot(T0);
    mockFetch.mockResolvedValueOnce(okResult(payload('UP78JT9999')));
    const next = await getLiveSnapshot(T0 + DEPOT.serveLastGoodWithinMs + 1, DEPOT);
    expect(next.source).toBe('live');
    expect(next.snapshot.depotRows[0]?.registrationNumber).toBe('UP78JT9999');
  });

  it('leaves a caller without the option waiting for the refresh, as before', async () => {
    mockFetch.mockResolvedValueOnce(okResult(payload('UP78JT4102')));
    await getLiveSnapshot(T0);
    mockFetch.mockResolvedValueOnce(okResult(payload('UP78JT9999')));
    const next = await getLiveSnapshot(T0 + LIVE_CACHE_TTL_MS + 1);
    expect(next.source).toBe('live');
    expect(next.stale).toBe(false);
    expect(next.snapshot.buses[0]?.registrationNumber).toBe('UP78JT9999');
  });
});

describe('live snapshot: a reply far shorter than the last good one', () => {
  const fleet = (count: number): unknown[] =>
    Array.from({ length: count }, (_, i) => payload(`UP78JT${String(1000 + i)}`)[0]);

  beforeEach(() => {
    resetLiveSnapshotForTests();
    mockFetch.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('is a failed refresh: last-good is served, flagged stale, with the reason kept', async () => {
    mockFetch.mockResolvedValueOnce(okResult(fleet(10)));
    const first = await getLiveSnapshot(T0);
    mockFetch.mockResolvedValueOnce(okResult(fleet(4)));
    const next = await getLiveSnapshot(T0 + LIVE_CACHE_TTL_MS + 1);
    expect(next.source).toBe('cache');
    expect(next.stale).toBe(true);
    expect(next.snapshot).toBe(first.snapshot);
    expect(liveDiagnostics.lastError).toBe(
      'Upstream reply had 4 bus rows against 10 in the last good reply',
    );
  });

  it('is served as live at exactly the named share', async () => {
    expect(MIN_ROWS_SHARE_OF_LAST_GOOD).toBe(0.5);
    mockFetch.mockResolvedValueOnce(okResult(fleet(10)));
    await getLiveSnapshot(T0);
    mockFetch.mockResolvedValueOnce(okResult(fleet(5)));
    const next = await getLiveSnapshot(T0 + LIVE_CACHE_TTL_MS + 1);
    expect(next.source).toBe('live');
    expect(next.snapshot.depotRows).toHaveLength(5);
  });

  it("is taken as the fleet's new size once it repeats, so old data is not held for ever", async () => {
    mockFetch.mockResolvedValueOnce(okResult(fleet(10)));
    await getLiveSnapshot(T0);
    mockFetch.mockResolvedValue(okResult(fleet(4)));
    let at = T0 + LIVE_CACHE_TTL_MS + 1;
    for (let refused = 1; refused < SHORT_REPLIES_BEFORE_ACCEPTED; refused += 1) {
      expect((await getLiveSnapshot(at)).source).toBe('cache');
      at += LIVE_RETRY_BACKOFF_MS;
    }
    const accepted = await getLiveSnapshot(at);
    expect(accepted.source).toBe('live');
    expect(accepted.snapshot.depotRows).toHaveLength(4);
    // The count starts again: a later short reply is refused once more.
    mockFetch.mockResolvedValueOnce(okResult(fleet(1)));
    expect((await getLiveSnapshot(at + LIVE_CACHE_TTL_MS + 1)).source).toBe('cache');
  });
});

describe('live snapshot: an answer is timed from when it arrived', () => {
  const UPSTREAM_WAIT_MS = 8_000;

  beforeEach(() => {
    resetLiveSnapshotForTests();
    mockFetch.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  const slowly = (result: UpstreamFetchResult) => async (): Promise<UpstreamFetchResult> => {
    vi.setSystemTime(Date.now() + UPSTREAM_WAIT_MS);
    return result;
  };

  it('stamps the fetch time and starts the TTL when a slow answer arrives', async () => {
    mockFetch.mockImplementationOnce(slowly(okResult(payload('UP78JT4102'))));
    const first = await getLiveSnapshot(T0);
    const arrived = T0 + UPSTREAM_WAIT_MS;
    expect(first.snapshot.fetchedAt).toBe(new Date(arrived).toISOString());

    const cached = await getLiveSnapshot(arrived + LIVE_CACHE_TTL_MS - 1);
    expect(cached.source).toBe('cache');
    expect(cached.stale).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('starts the back-off when a slow failure arrives', async () => {
    mockFetch.mockImplementationOnce(slowly(failResult));
    await getLiveSnapshot(T0);
    await getLiveSnapshot(T0 + UPSTREAM_WAIT_MS + LIVE_RETRY_BACKOFF_MS - 1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
