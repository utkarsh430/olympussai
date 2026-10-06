// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import liveFixture from '@/fixtures/upsrtc-live-sample.json';
import { deriveFeedNow, normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';
import type { DepotBusRow } from '@/models/depotLive';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';
import type { MetricKey } from '@/lib/depot/sim/types';
import { operatingDateOf } from '@/lib/depot/sim/seed';
import { analyseSnapshot, resetAnalysisForTests } from '@/lib/depot/live/analysis';
import {
  buildHistoryResponse,
  parseHistoryQuery,
  type HistoryQuery,
} from '@/lib/depot/live/historyView';

const FEED_NOW = '2026-10-06T08:00:00Z';
const METRICS: readonly MetricKey[] = [
  'onRoadShare',
  'offRoadRate',
  'darkRate',
  'index',
  'available',
];
const fixtureRows = normalizeDepotRows(liveFixture).rows;

function viewOf(rows: readonly DepotBusRow[], feedNow: string | null = FEED_NOW): FleetSnapshotView {
  return {
    rows,
    feedNow,
    fetchedAt: '2026-10-06T08:00:05.000Z',
    source: 'live',
    stale: false,
    recordCount: rows.length,
  };
}

const fixtureView = (): FleetSnapshotView => viewOf(fixtureRows, deriveFeedNow(fixtureRows));

function row(over: Partial<DepotBusRow>): DepotBusRow {
  return {
    registrationNumber: 'UP32A0000',
    latitude: 26.85,
    longitude: 80.95,
    speedKmph: 0,
    ignitionOn: false,
    gpsTimestamp: FEED_NOW,
    receivedAt: FEED_NOW,
    depotId: '1',
    depotName: 'Alambagh',
    vehicleStatus: 'stationary',
    tripStatus: null,
    routeId: null,
    routeName: null,
    routeDescription: null,
    journeyId: null,
    journeyCode: null,
    scheduledStart: null,
    scheduledEnd: null,
    actualStart: null,
    delayMinutes: null,
    odometerRaw: null,
    mainPowerOn: true,
    mainVoltage: null,
    tamperCode: 'C',
    emergency: false,
    ...over,
  };
}

function buses(depotId: string, name: string, count: number, moving: number): DepotBusRow[] {
  return Array.from({ length: count }, (_, i) =>
    row({
      registrationNumber: `UP${depotId}${String(i).padStart(4, '0')}`,
      depotId,
      depotName: name,
      ...(i < moving
        ? { speedKmph: 30, routeName: 'R1', vehicleStatus: 'live', ignitionOn: true }
        : {}),
    }),
  );
}

beforeEach(() => resetAnalysisForTests());

describe('buildHistoryResponse anchors', () => {
  const network = (metric: MetricKey, days = 30): HistoryQuery => ({
    metric,
    scope: { kind: 'network' },
    days,
  });

  it.each(METRICS)('ends the network %s series on its anchor', async (metric) => {
    const result = await buildHistoryResponse(fixtureView(), network(metric));
    expect(result.status).toBe(200);
    if (result.status !== 200) return;
    const { series, anchor, provenance } = result.body;
    expect(provenance).toBe('modelled');
    expect(series).toHaveLength(30);
    expect(series.at(-1)).toEqual(anchor);
    const view = fixtureView();
    expect(anchor.date).toBe(operatingDateOf(view.feedNow, view.fetchedAt));
  });

  it.each(METRICS)('ends the depot %s series on its anchor', async (metric) => {
    const analysis = analyseSnapshot(fixtureView());
    const ranked = analysis.scores.find((s) => s.ranked);
    expect(ranked).toBeDefined();
    const query: HistoryQuery = {
      metric,
      scope: { kind: 'depot', depotId: ranked?.depotId ?? '' },
      days: 14,
    };
    const result = await buildHistoryResponse(fixtureView(), query);
    expect(result.status).toBe(200);
    if (result.status !== 200) return;
    expect(result.body.series).toHaveLength(14);
    expect(result.body.series.at(-1)).toEqual(result.body.anchor);
  });

  it('anchors a depot on its live component values', async () => {
    const analysis = analyseSnapshot(fixtureView());
    const score = analysis.scores.find((s) => s.ranked);
    const depot = analysis.depotsById.get(score?.depotId ?? '');
    if (!score || !depot) throw new Error('no ranked depot in fixture');
    const onRoad = score.components.find((c) => c.key === 'onRoad')?.value ?? 0;
    const run = (metric: MetricKey) =>
      buildHistoryResponse(fixtureView(), {
        metric,
        scope: { kind: 'depot', depotId: depot.id },
        days: 7,
      });
    const share = await run('onRoadShare');
    const index = await run('index');
    const available = await run('available');
    expect(share.status === 200 && share.body.anchor.value).toBe(Math.round(onRoad * 1e4) / 1e4);
    expect(index.status === 200 && index.body.anchor.value).toBe(score.index);
    expect(available.status === 200 && available.body.anchor.value).toBe(
      depot.fleet - depot.states.offRoad,
    );
  });

  it('computes the network on-road share as a ratio of sums, not a mean of rates', async () => {
    // Depot 1: 2 of 2 on the road (share 1). Depot 2: 2 of 20 (share 0.1). Mean 0.55, ratio 4/22.
    // An enforcement squad of 10 buses, all moving, would lift the ratio to 14/32 if it were counted.
    const view = viewOf([
      ...buses('1', 'Alambagh', 2, 2),
      ...buses('2', 'Kaiserbagh', 20, 2),
      ...buses('3', 'Enforcement Squad', 10, 10),
    ]);
    const result = await buildHistoryResponse(view, network('onRoadShare'));
    expect(result.status).toBe(200);
    if (result.status !== 200) return;
    expect(result.body.anchor.value).toBe(Math.round((4 / 22) * 1e4) / 1e4);
    expect(result.body.anchor.value).not.toBe(0.55);
    expect(result.body.anchor.value).not.toBe(Math.round((14 / 32) * 1e4) / 1e4);
  });

  it('responds 404 for an unranked depot index and an unknown depot', async () => {
    const view = viewOf(buses('1', 'Alambagh', 3, 1));
    const index = await buildHistoryResponse(view, {
      metric: 'index',
      scope: { kind: 'depot', depotId: '1' },
      days: 30,
    });
    expect(index).toEqual({ status: 404, body: { error: 'No index for this depot' } });
    const network404 = await buildHistoryResponse(view, network('index'));
    expect(network404).toEqual({ status: 404, body: { error: 'No index for this depot' } });
    const unknown = await buildHistoryResponse(view, {
      metric: 'available',
      scope: { kind: 'depot', depotId: '999' },
      days: 30,
    });
    expect(unknown).toEqual({ status: 404, body: { error: 'Depot not found' } });
  });

  it('responds 404 when the metric has a zero denominator', async () => {
    const parked = buses('1', 'Alambagh', 3, 0).map((r) => ({
      ...r,
      vehicleStatus: 'under_maintenance' as const,
    }));
    const result = await buildHistoryResponse(viewOf(parked), network('onRoadShare'));
    expect(result).toEqual({ status: 404, body: { error: 'No value for this metric' } });
  });
});

describe('parseHistoryQuery', () => {
  const parse = (qs: string) => parseHistoryQuery(new URLSearchParams(qs));

  it('accepts the valid forms and defaults days to 30', () => {
    expect(parse('metric=index&scope=network')).toEqual({
      ok: true,
      query: { metric: 'index', scope: { kind: 'network' }, days: 30 },
    });
    expect(parse('metric=available&scope=depot&depotId=12&days=180')).toEqual({
      ok: true,
      query: { metric: 'available', scope: { kind: 'depot', depotId: '12' }, days: 180 },
    });
    expect(parse('metric=darkRate&scope=network&days=7')).toMatchObject({ ok: true });
  });

  it.each([
    ['missing metric', 'scope=network'],
    ['unknown metric', 'metric=speed&scope=network'],
    ['missing scope', 'metric=index'],
    ['unknown scope', 'metric=index&scope=region'],
    ['depotId with network', 'metric=index&scope=network&depotId=1'],
    ['missing depotId', 'metric=index&scope=depot'],
    ['hostile depotId', 'metric=index&scope=depot&depotId=1%27%20OR%201'],
    ['path-like depotId', 'metric=index&scope=depot&depotId=..%2F..'],
    ['days 6', 'metric=index&scope=network&days=6'],
    ['days 181', 'metric=index&scope=network&days=181'],
    ['days 30.5', 'metric=index&scope=network&days=30.5'],
    ['days abc', 'metric=index&scope=network&days=abc'],
    ['empty days', 'metric=index&scope=network&days='],
    ['extra parameter', 'metric=index&scope=network&extra=1'],
    ['duplicate metric', 'metric=index&metric=available&scope=network'],
  ])('rejects %s', (_label, qs) => {
    expect(parse(qs)).toEqual({ ok: false });
  });
});
