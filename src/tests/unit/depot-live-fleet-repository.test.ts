import { describe, expect, it } from 'vitest';
import type { LiveSnapshotResult } from '@/lib/upsrtc/liveSnapshot';
import {
  LAST_GOOD_FRESH_MS,
  createLiveFleetRepository,
} from '@/lib/depot/repositories/liveFleetRepository';

const FETCHED_MS = Date.parse('2026-10-06T10:00:00.000Z');

function result(source: LiveSnapshotResult['source'], stale: boolean): LiveSnapshotResult {
  const snapshot = {
    depotRows: [],
    feedNow: '2026-10-06T15:30:00.000Z',
    fetchedAt: new Date(FETCHED_MS).toISOString(),
    recordCount: 0,
  };
  return { snapshot, source, stale } as unknown as LiveSnapshotResult;
}

function staleAt(source: LiveSnapshotResult['source'], stale: boolean, ageMs: number) {
  const repository = createLiveFleetRepository(
    () => Promise.resolve(result(source, stale)),
    () => FETCHED_MS + ageMs,
  );
  return repository.snapshot().then((view) => view.stale);
}

/**
 * The shared snapshot marks every answer served after a failed refresh as stale, however
 * young the last good data is. For the depot pages one failed refresh is not an outage:
 * the feed itself changes about every 40 seconds. Freshness, not the path that served the
 * answer, decides the flag the depot pages see.
 */
describe('live fleet repository: when the depot pages call the feed stale', () => {
  it('is not stale for a live or freshly cached answer', async () => {
    expect(await staleAt('live', false, 0)).toBe(false);
    expect(await staleAt('cache', false, 14_000)).toBe(false);
  });

  it('is not stale for last-good data younger than the fresh limit', async () => {
    expect(await staleAt('cache', true, 30_000)).toBe(false);
    expect(await staleAt('cache', true, LAST_GOOD_FRESH_MS)).toBe(false);
  });

  it('is stale for last-good data older than the fresh limit', async () => {
    expect(await staleAt('cache', true, LAST_GOOD_FRESH_MS + 1)).toBe(true);
    expect(await staleAt('cache', true, 10 * 60_000)).toBe(true);
  });

  // P7: a machine clock stepped back below the fetch time must not keep old data fresh.
  it('is stale for last-good data whose age is negative (the machine clock stepped back)', async () => {
    expect(await staleAt('cache', true, -1)).toBe(true);
    expect(await staleAt('cache', true, -10 * 60_000)).toBe(true);
  });

  it('is always stale for the saved sample, whatever its age', async () => {
    expect(await staleAt('fixture', true, 0)).toBe(true);
    expect(await staleAt('fixture', false, 0)).toBe(true);
  });

  it('stays stale when the fetch time cannot be read', async () => {
    const broken = result('cache', true);
    const repository = createLiveFleetRepository(
      () =>
        Promise.resolve({
          ...broken,
          snapshot: { ...broken.snapshot, fetchedAt: 'not a time' },
        } as LiveSnapshotResult),
      () => FETCHED_MS,
    );
    expect((await repository.snapshot()).stale).toBe(true);
  });

  it('keeps the fresh limit at two of the feed\'s own periods or more', () => {
    expect(LAST_GOOD_FRESH_MS).toBeGreaterThanOrEqual(80_000);
  });
});
