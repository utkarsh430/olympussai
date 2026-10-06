import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/upsrtc/client', () => ({
  fetchUpstream: vi.fn(),
  UPSRTC_LIVE_URL: 'https://upstream.test/live',
  REQUEST_TIMEOUT_MS: 10_000,
}));

vi.mock('@/lib/upsrtc/normalizer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/upsrtc/normalizer')>();
  return { ...actual, normalizeLivePayload: vi.fn(actual.normalizeLivePayload) };
});

import { normalizeLivePayload } from '@/lib/upsrtc/normalizer';
import { getLiveSnapshot, resetLiveSnapshotForTests } from '@/lib/upsrtc/liveSnapshot';

const mockNormalize = vi.mocked(normalizeLivePayload);
const T0 = 1_800_000_000_000;

describe('live snapshot: the saved sample builds the map projection only when it is read', () => {
  const originalDemo = process.env.NEXT_PUBLIC_DEMO_MODE;

  beforeEach(() => {
    resetLiveSnapshotForTests();
    process.env.NEXT_PUBLIC_DEMO_MODE = '1';
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.mocked(console.error).mockRestore();
    if (originalDemo === undefined) delete process.env.NEXT_PUBLIC_DEMO_MODE;
    else process.env.NEXT_PUBLIC_DEMO_MODE = originalDemo;
  });

  it('does not re-run the map projection for callers that read only the depot rows', async () => {
    const first = await getLiveSnapshot(T0);
    const afterLoad = mockNormalize.mock.calls.length;
    for (let i = 1; i <= 5; i += 1) {
      const { snapshot } = await getLiveSnapshot(T0 + i * 60_000);
      expect(snapshot.depotRows).toBe(first.snapshot.depotRows);
      expect(snapshot.recordCount).toBe(first.snapshot.recordCount);
    }
    expect(mockNormalize.mock.calls.length).toBe(afterLoad);
  });

  it('gives a caller that reads the buses the same projection as before, stamped now', async () => {
    const { snapshot } = await getLiveSnapshot(T0 + 60_000);
    const before = mockNormalize.mock.calls.length;
    const buses = snapshot.buses;
    expect(snapshot.buses).toBe(buses);
    expect(mockNormalize.mock.calls.length).toBe(before + 1);

    const direct = vi.mocked(normalizeLivePayload).mock.results.at(-1)?.value;
    expect(buses).toEqual(direct?.buses);
    expect(buses[0]?.lastUpdatedAt).toBe(new Date(T0 + 60_000).toISOString());
    expect(snapshot.recordCount).toBe(direct?.recordCount);
    expect(snapshot.rejectedRecordCount).toBe(direct?.rejectedRecordCount);
  });
});
