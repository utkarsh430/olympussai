import { describe, expect, it } from 'vitest';
import liveFixture from '@/fixtures/upsrtc-live-sample.json';
import { deriveFeedNow, normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';
import { analyseSnapshot } from '@/lib/depot/live/analysis';
import { buildForecastResponse } from '@/lib/depot/live/forecastView';
import type { HistoryScope } from '@/lib/depot/sim/types';

/**
 * Through the server views: the available-buses history and its forecast stay
 * within [0, fleet] for every depot of the recorded feed and for the network.
 */

const rows = normalizeDepotRows(liveFixture).rows;
const view: FleetSnapshotView = {
  rows,
  feedNow: deriveFeedNow(rows),
  fetchedAt: '2026-10-06T08:00:05.000Z',
  source: 'live',
  stale: false,
  recordCount: rows.length,
};

async function breachesFor(scope: HistoryScope, fleet: number): Promise<string[]> {
  const result = await buildForecastResponse(view, {
    metric: 'available',
    scope,
    days: 90,
    horizon: 28,
  });
  if (result.status !== 200) return [];
  const forecast = result.body.forecast.result;
  const values = [
    ...result.body.history.series.map((p) => p.value),
    ...(forecast.status === 'ok' ? forecast.forecast.points.flatMap((p) => [p.value, p.low, p.high]) : []),
  ];
  return values.filter((v) => v < 0 || v > fleet).map((v) => `${JSON.stringify(scope)} ${v} > ${fleet}`);
}

describe('available buses within the fleet, through the views', () => {
  it('holds for every depot and the network', async () => {
    const depots = analyseSnapshot(view).depots.filter((d) => d.kind === 'depot');
    const networkFleet = depots.reduce((total, d) => total + d.fleet, 0);
    const breaches = [
      ...(await breachesFor({ kind: 'network' }, networkFleet)),
      ...(await Promise.all(depots.map((d) => breachesFor({ kind: 'depot', depotId: d.id }, d.fleet)))).flat(),
    ];
    expect(breaches).toEqual([]);
  });
});
