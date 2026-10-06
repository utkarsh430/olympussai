// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import liveFixture from '@/fixtures/upsrtc-live-sample.json';
import { normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';
import type { DepotBusRow } from '@/models/depotLive';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';
import { EXCEPTION_BASIS } from '@/lib/depot/exceptions/config';
import { analyseSnapshot, resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { buildExceptionsResponse } from '@/lib/depot/live/exceptionView';
import { buildHistoryResponse } from '@/lib/depot/live/historyView';
import { buildNetworkResponse } from '@/lib/depot/live/networkView';

/*
 * M6: windowed and as-of-feed-time figures are told apart. Every exception
 * says which it is, the responses that count them say which kinds are which,
 * and a depot's trend is anchored on the same windowed values the league shows.
 */

const rows = normalizeDepotRows(liveFixture).rows;
const F0 = '2026-10-06T08:00:00.000Z';
const F1 = '2026-10-06T08:01:00.000Z';

function viewOf(r: readonly DepotBusRow[], feedNow: string): FleetSnapshotView {
  return {
    rows: r,
    feedNow,
    fetchedAt: feedNow,
    source: 'live',
    stale: false,
    recordCount: r.length,
  };
}

describe('exception basis (M6)', () => {
  beforeEach(() => resetAnalysisForTests());

  it('marks peer comparisons as windowed and everything else as of the feed time', () => {
    expect(EXCEPTION_BASIS).toEqual({
      dark_share_high: 'window',
      off_road_high: 'window',
      on_road_low: 'window',
      power_cut_cluster: 'feed_time',
      long_dark: 'feed_time',
      power_cut: 'feed_time',
      tamper_code: 'feed_time',
      emergency: 'feed_time',
    });
    const analysis = analyseSnapshot(viewOf(rows, F0));
    expect(analysis.report.depot.length).toBeGreaterThan(0);
    expect(analysis.busExceptions.length).toBeGreaterThan(0);
    for (const e of [...analysis.report.depot, ...analysis.busExceptions]) {
      expect(e.basis).toBe(EXCEPTION_BASIS[e.kind]);
    }
    expect(buildNetworkResponse(viewOf(rows, F0)).exceptionBasis).toEqual(EXCEPTION_BASIS);
    expect(buildExceptionsResponse(viewOf(rows, F0)).exceptionBasis).toEqual(EXCEPTION_BASIS);
  });

  it('anchors a depot trend on the windowed component values the league shows', async () => {
    const first = analyseSnapshot(viewOf(rows, F0));
    const depotId = first.scores.find((s) => s.ranked)?.depotId ?? '';
    let changed = 0;
    const later = rows.map((r) => {
      if (r.depotId !== depotId || changed >= 3 || r.vehicleStatus === 'under_maintenance')
        return r;
      changed += 1;
      return { ...r, vehicleStatus: 'under_maintenance' as const };
    });
    const view = viewOf(later, F1);
    const score = analyseSnapshot(view).scoresById.get(depotId);
    expect(score?.samples).toBe(2);
    const scope = { kind: 'depot' as const, depotId };
    for (const [metric, key] of [
      ['onRoadShare', 'onRoad'],
      ['offRoadRate', 'offRoad'],
      ['darkRate', 'dark'],
    ] as const) {
      const windowed = score?.components.find((c) => c.key === key)?.value ?? null;
      const result = await buildHistoryResponse(view, { metric, scope, days: 7 });
      expect(result.status === 200 && result.body.anchor.value).toBe(
        windowed === null ? null : Math.round(windowed * 1e4) / 1e4,
      );
    }
  });
});
