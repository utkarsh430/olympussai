import { describe, it, expect } from 'vitest';
import type { LiveSnapshotResult } from '@/lib/upsrtc/liveSnapshot';
import { modelSeries } from '@/lib/depot/sim/history';
import { createLiveFleetRepository } from '@/lib/depot/repositories/liveFleetRepository';
import { modelledHistoryRepository } from '@/lib/depot/repositories/modelledHistoryRepository';
import { getRepositories } from '@/lib/depot/repositories';

const FEED_NOW = '2026-10-06T08:00:00Z';

describe('depot repositories', () => {
  it('adapts the live snapshot to a fleet view without copying rows', async () => {
    const depotRows = [] as LiveSnapshotResult['snapshot']['depotRows'];
    const result: LiveSnapshotResult = {
      snapshot: {
        buses: [],
        depotRows,
        recordCount: 7,
        rejectedRecordCount: 1,
        fetchedAt: '2026-10-06T08:00:05.000Z',
        feedNow: FEED_NOW,
      },
      source: 'cache',
      stale: true,
    };
    const view = await createLiveFleetRepository(async () => result).snapshot();
    expect(view).toEqual({
      rows: depotRows,
      feedNow: FEED_NOW,
      fetchedAt: '2026-10-06T08:00:05.000Z',
      source: 'cache',
      stale: true,
      recordCount: 7,
    });
    expect(view.rows).toBe(depotRows);
  });

  it('serves the modelled history series', async () => {
    const anchor = { date: '2026-10-06', value: 0.6 };
    const scope = { kind: 'network' } as const;
    const series = await modelledHistoryRepository.series('onRoadShare', scope, 30, anchor);
    expect(series).toEqual(modelSeries('onRoadShare', scope, 30, anchor));
  });

  it('has one composition root', () => {
    const repos = getRepositories();
    expect(getRepositories()).toBe(repos);
    expect(repos.history).toBe(modelledHistoryRepository);
    expect(typeof repos.fleet.snapshot).toBe('function');
  });
});
