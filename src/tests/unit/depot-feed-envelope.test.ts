import { describe, expect, it } from 'vitest';
import { feedEnvelope } from '@/lib/depot/live/analysis';
import { createLiveFleetRepository } from '@/lib/depot/repositories/liveFleetRepository';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';
import type { LiveSnapshotResult } from '@/lib/upsrtc/liveSnapshot';

const VIEW: FleetSnapshotView = {
  rows: [],
  feedNow: '2026-10-06T15:30:00.000Z',
  fetchedAt: '2026-10-06T10:00:00.000Z',
  source: 'live',
  stale: false,
  recordCount: 0,
};

/**
 * A receive time later than the server's own clock allows is ignored when the feed clock
 * is read. The count of such rows travels with every depot response, so a page can say
 * that the clock may lag instead of the lag going unnoticed.
 */
describe('rows ignored for the feed clock', () => {
  it('is passed through by the fleet repository', async () => {
    const result = {
      snapshot: { ...VIEW, depotRows: [], feedClockAheadRows: 7 },
      source: 'live',
      stale: false,
    } as unknown as LiveSnapshotResult;
    const repository = createLiveFleetRepository(() => Promise.resolve(result));
    expect((await repository.snapshot()).feedClockAheadRows).toBe(7);
  });

  it('travels in the envelope only when rows were ignored', () => {
    expect(feedEnvelope({ ...VIEW, feedClockAheadRows: 7 }).feedClockAheadRows).toBe(7);
    expect('feedClockAheadRows' in feedEnvelope({ ...VIEW, feedClockAheadRows: 0 })).toBe(false);
    expect('feedClockAheadRows' in feedEnvelope(VIEW)).toBe(false);
  });

  it('leaves the rest of the envelope as it was', () => {
    expect(feedEnvelope(VIEW)).toEqual({
      feedNow: VIEW.feedNow,
      fetchedAt: VIEW.fetchedAt,
      source: 'live',
      stale: false,
    });
  });
});
