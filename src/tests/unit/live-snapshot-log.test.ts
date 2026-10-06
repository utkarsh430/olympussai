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
  getLiveSnapshot,
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

const ok: UpstreamFetchResult = {
  ok: true,
  status: 200,
  contentType: 'application/json',
  payload: [
    {
      regNum: 'UP78JT4102',
      latitude: 28.36,
      longitude: 79.43,
      timestamp: '2026-07-20T07:01:32Z',
      receivedTime: '2026-07-20T07:01:50Z',
      home_depot: '81',
    },
  ],
};
const failed = (error: string): UpstreamFetchResult => ({
  ok: false,
  status: 502,
  contentType: 'unknown',
  payload: null,
  error,
});

describe('live snapshot: one log line per change of what is served', () => {
  const originalDemo = process.env.NEXT_PUBLIC_DEMO_MODE;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  const lines = (): string[] =>
    [...errorSpy.mock.calls, ...warnSpy.mock.calls].map((call) => String(call[0]));

  beforeEach(() => {
    resetLiveSnapshotForTests();
    mockFetch.mockReset();
    delete process.env.NEXT_PUBLIC_DEMO_MODE;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    if (originalDemo === undefined) delete process.env.NEXT_PUBLIC_DEMO_MODE;
    else process.env.NEXT_PUBLIC_DEMO_MODE = originalDemo;
  });

  it('logs the move to last-good once, with the reason, however many requests follow', async () => {
    mockFetch.mockResolvedValueOnce(ok);
    await getLiveSnapshot(T0);
    mockFetch.mockResolvedValue(failed('HTTP 502'));
    const failedAt = T0 + LIVE_CACHE_TTL_MS + 1;
    await getLiveSnapshot(failedAt);
    await getLiveSnapshot(failedAt + 1_000);
    await getLiveSnapshot(failedAt + LIVE_RETRY_BACKOFF_MS);
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(lines()).toEqual([
      '[depot:live-snapshot] serving last good data instead of live data: ' +
        'upstream refresh failed (HTTP 502)',
    ]);
  });

  it('logs the move to the saved sample once when there is no last-good', async () => {
    mockFetch.mockResolvedValue(failed('Upstream timed out after 10000ms'));
    await getLiveSnapshot(T0);
    await getLiveSnapshot(T0 + 1);
    await getLiveSnapshot(T0 + LIVE_RETRY_BACKOFF_MS);
    expect(lines()).toEqual([
      '[depot:live-snapshot] serving the saved sample instead of live data: ' +
        'upstream refresh failed (Upstream timed out after 10000ms)',
    ]);
  });

  it('logs the recovery once, as a warning', async () => {
    mockFetch.mockResolvedValueOnce(failed('HTTP 502'));
    await getLiveSnapshot(T0);
    mockFetch.mockResolvedValue(ok);
    await getLiveSnapshot(T0 + LIVE_RETRY_BACKOFF_MS);
    await getLiveSnapshot(T0 + LIVE_RETRY_BACKOFF_MS + LIVE_CACHE_TTL_MS + 1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      '[depot:live-snapshot] upstream recovered; serving live data again instead of the saved sample',
    );
  });

  it('never writes an address, which may carry credentials, into the line', async () => {
    mockFetch.mockResolvedValue(failed('request to https://user:secret@feed.example/x?key=k1 failed'));
    await getLiveSnapshot(T0);
    const [line] = lines();
    expect(line).toContain('(address withheld)');
    expect(line).not.toContain('secret');
    expect(line).not.toContain('key=k1');
  });

  it('logs demo mode once', async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = '1';
    await getLiveSnapshot(T0);
    await getLiveSnapshot(T0 + 60_000);
    expect(lines()).toEqual([
      '[depot:live-snapshot] serving the saved sample instead of live data: demo mode is on',
    ]);
  });

  it('logs nothing while the feed answers', async () => {
    mockFetch.mockResolvedValue(ok);
    await getLiveSnapshot(T0);
    await getLiveSnapshot(T0 + LIVE_CACHE_TTL_MS + 1);
    expect(lines()).toEqual([]);
  });
});
