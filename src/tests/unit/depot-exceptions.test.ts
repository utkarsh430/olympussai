import { describe, it, expect } from 'vitest';
import type { DepotBusRow } from '@/models/depotLive';
import type { BusOpState, DepotSummary } from '@/lib/depot/types';
import type { DeiComponentKey, DepotScore } from '@/lib/depot/score/types';
import { classifyBusState } from '@/lib/depot/infer/busState';
import { LONG_DARK_AFTER_MIN } from '@/lib/depot/infer/thresholds';
import {
  BUS_EXCEPTION_CAP,
  EXCEPTION_Z,
  MIN_RATE_GAP,
  buildExceptionReport,
  detectBusExceptions,
  detectDepotExceptions,
} from '@/lib/depot/exceptions';

const FEED_NOW = '2026-10-06T08:00:00Z';
const minutesAgo = (min: number): string =>
  new Date(Date.parse(FEED_NOW) - min * 60_000).toISOString();

function row(over: Partial<DepotBusRow> = {}): DepotBusRow {
  return {
    registrationNumber: 'UP32A0001',
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

function depot(over: Partial<DepotSummary> = {}): DepotSummary {
  return {
    id: '1',
    name: 'Alambagh',
    kind: 'depot',
    fleet: 20,
    status: { live: 10, stationary: 10, noSignal: 0, underMaintenance: 0, unknown: 0 },
    states: { inService: 8, onRoad: 2, standing: 10, dark: 0, offRoad: 0 },
    reporting: 20,
    positioned: 20,
    assigned: 8,
    powerCut: 0,
    tamperFlagged: 0,
    centroid: null,
    ...over,
  };
}

type Comp = { value: number | null; peerMedian: number | null; z: number | null };

function score(depotId: string, comps: Partial<Record<DeiComponentKey, Comp>>, ranked = true): DepotScore {
  const keys: DeiComponentKey[] = ['onRoad', 'offRoad', 'dark', 'scheduled', 'deviceHealth'];
  return {
    depotId,
    peerGroup: ranked ? 'all' : null,
    ranked,
    reason: ranked ? 'ok' : 'fleet_too_small',
    index: ranked ? 50 : null,
    rank: ranked ? 1 : null,
    peerCount: ranked ? 5 : null,
    components: keys.map((key) => ({
      key,
      value: comps[key]?.value ?? 0.5,
      peerMedian: comps[key]?.peerMedian ?? 0.5,
      z: comps[key]?.z ?? 0,
      contribution: 0,
    })),
  };
}

const stateOf = (feedNow: string | null) => (r: DepotBusRow): BusOpState =>
  classifyBusState(r, feedNow);

describe('depot exceptions', () => {
  const D = depot({ states: { inService: 2, onRoad: 0, standing: 6, dark: 8, offRoad: 4 } });
  const run = (comps: Partial<Record<DeiComponentKey, Comp>>, ranked = true) =>
    detectDepotExceptions([D], [score('1', comps, ranked)], [], stateOf(FEED_NOW));

  it('fires dark_share_high at z = -EXCEPTION_Z with a large enough gap', () => {
    const [ex, ...rest] = run({ dark: { value: 0.4, peerMedian: 0.2, z: -EXCEPTION_Z } });
    expect(rest).toEqual([]);
    expect(ex).toEqual({
      id: 'dark_share_high:1',
      depotId: '1',
      depotName: 'Alambagh',
      kind: 'dark_share_high',
      severity: 'warning',
      value: 0.4,
      peerMedian: 0.2,
      z: -2,
      affected: 8,
      fleet: 20,
    });
  });

  it('does not fire just inside the z threshold or below the rate gap', () => {
    expect(run({ dark: { value: 0.4, peerMedian: 0.2, z: -1.99 } })).toEqual([]);
    expect(run({ dark: { value: 0.29, peerMedian: 0.2, z: -2.5 } })).toEqual([]);
    expect(MIN_RATE_GAP).toBe(0.1);
  });

  it('fires at exactly the rate gap', () => {
    expect(run({ dark: { value: 0.3, peerMedian: 0.2, z: -2 } })).toHaveLength(1);
  });

  it('is critical from |z| = 3', () => {
    expect(run({ dark: { value: 0.6, peerMedian: 0.2, z: -3 } })[0]?.severity).toBe('critical');
    expect(run({ dark: { value: 0.6, peerMedian: 0.2, z: -2.99 } })[0]?.severity).toBe('warning');
  });

  it('never fires in the good direction', () => {
    expect(run({ dark: { value: 0.0, peerMedian: 0.2, z: 3 } })).toEqual([]);
    expect(run({ onRoad: { value: 0.9, peerMedian: 0.5, z: 3 } })).toEqual([]);
  });

  it('maps off-road and on-road components to their kinds', () => {
    const out = run({
      offRoad: { value: 0.2, peerMedian: 0.05, z: -2.5 },
      onRoad: { value: 0.125, peerMedian: 0.6, z: -3 },
    });
    expect(out.map((e) => [e.kind, e.affected, e.severity])).toEqual([
      ['on_road_low', 14, 'critical'],
      ['off_road_high', 4, 'warning'],
    ]);
  });

  it('never fires for an unranked depot, whatever its components say', () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      row({ registrationNumber: `R${i}`, mainPowerOn: false }),
    );
    const out = detectDepotExceptions(
      [D],
      [score('1', { dark: { value: 0.9, peerMedian: 0.1, z: -3 } }, false)],
      rows,
      stateOf(FEED_NOW),
    );
    expect(out).toEqual([]);
  });

  it('never fires for a depot with no score', () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      row({ registrationNumber: `R${i}`, mainPowerOn: false }),
    );
    expect(detectDepotExceptions([D], [], rows, stateOf(FEED_NOW))).toEqual([]);
  });
});

describe('power_cut_cluster', () => {
  const powerCut = (n: number, over: Partial<DepotBusRow> = {}): DepotBusRow[] =>
    Array.from({ length: n }, (_, i) =>
      row({ registrationNumber: `P${i}`, mainPowerOn: false, ...over }),
    );
  const run = (fleet: number, rows: readonly DepotBusRow[]) =>
    detectDepotExceptions([depot({ fleet })], [score('1', {})], rows, stateOf(FEED_NOW));

  it('needs at least three buses in a small depot', () => {
    expect(run(20, powerCut(2))).toEqual([]);
    const [ex] = run(20, powerCut(3));
    expect(ex).toMatchObject({
      id: 'power_cut_cluster:1',
      kind: 'power_cut_cluster',
      severity: 'warning',
      value: 3,
      affected: 3,
      peerMedian: null,
      z: null,
      fleet: 20,
    });
  });

  it('needs ten percent of a large fleet', () => {
    expect(run(50, powerCut(4))).toEqual([]);
    expect(run(50, powerCut(5))).toHaveLength(1);
  });

  it('ignores off-road buses', () => {
    const offRoad = powerCut(3, { vehicleStatus: 'under_maintenance' });
    expect(run(20, [...powerCut(2), ...offRoad.map((r, i) => ({ ...r, registrationNumber: `O${i}` }))]))
      .toEqual([]);
  });
});

describe('bus exceptions', () => {
  const kinds = (rows: readonly DepotBusRow[], feedNow: string | null = FEED_NOW) =>
    detectBusExceptions(rows, [depot()], feedNow, stateOf(feedNow)).map((e) => e.kind);

  it('long_dark fires strictly beyond LONG_DARK_AFTER_MIN', () => {
    const old = minutesAgo(LONG_DARK_AFTER_MIN + 1);
    expect(kinds([row({ gpsTimestamp: minutesAgo(LONG_DARK_AFTER_MIN) })])).toEqual([]);
    const [ex] = detectBusExceptions([row({ gpsTimestamp: old })], [depot()], FEED_NOW, stateOf(FEED_NOW));
    expect(ex).toEqual({
      id: 'long_dark:UP32A0001',
      registrationNumber: 'UP32A0001',
      depotId: '1',
      depotName: 'Alambagh',
      kind: 'long_dark',
      severity: 'warning',
      lastSeen: old,
      detail: null,
    });
  });

  it('long_dark never fires when feedNow is null', () => {
    const ancient = row({ gpsTimestamp: '2020-01-01T00:00:00Z', vehicleStatus: 'no_signal' });
    expect(kinds([ancient], null)).toEqual([]);
  });

  it('long_dark and power_cut skip off-road buses', () => {
    const offRoad = row({
      vehicleStatus: 'under_maintenance',
      gpsTimestamp: minutesAgo(LONG_DARK_AFTER_MIN * 2),
      mainPowerOn: false,
    });
    expect(kinds([offRoad])).toEqual([]);
  });

  it('power_cut is info and needs mainPowerOn === false', () => {
    expect(kinds([row({ mainPowerOn: null })])).toEqual([]);
    const [ex] = detectBusExceptions([row({ mainPowerOn: false })], [depot()], FEED_NOW, stateOf(FEED_NOW));
    expect(ex).toMatchObject({ id: 'power_cut:UP32A0001', severity: 'info', detail: null });
  });

  it('tamper_code carries the raw code and ignores C and null', () => {
    expect(kinds([row({ tamperCode: 'C' }), row({ registrationNumber: 'B', tamperCode: null })]))
      .toEqual([]);
    const [ex] = detectBusExceptions([row({ tamperCode: 'W' })], [depot()], FEED_NOW, stateOf(FEED_NOW));
    expect(ex).toMatchObject({ kind: 'tamper_code', severity: 'info', detail: 'W' });
  });

  it('emergency is critical and needs emergency === true', () => {
    expect(kinds([row({ emergency: null })])).toEqual([]);
    const [ex] = detectBusExceptions([row({ emergency: true })], [depot()], FEED_NOW, stateOf(FEED_NOW));
    expect(ex).toMatchObject({ id: 'emergency:UP32A0001', severity: 'critical' });
  });

  it('a bus without a home depot keeps null depot fields', () => {
    const [ex] = detectBusExceptions(
      [row({ depotId: null, depotName: null, emergency: true })],
      [depot()],
      FEED_NOW,
      stateOf(FEED_NOW),
    );
    expect(ex).toMatchObject({ depotId: null, depotName: null });
  });

  it('sorts by severity, then depot name, then registration', () => {
    const depots = [depot(), depot({ id: '2', name: 'Barabanki' })];
    const rows = [
      row({ registrationNumber: 'Z1', depotId: '2', depotName: 'Barabanki', tamperCode: 'W' }),
      row({ registrationNumber: 'B1', tamperCode: 'O' }),
      row({ registrationNumber: 'A1', tamperCode: 'W' }),
      row({ registrationNumber: 'Y1', depotId: '2', depotName: 'Barabanki', emergency: true }),
      row({ registrationNumber: 'X1', gpsTimestamp: minutesAgo(LONG_DARK_AFTER_MIN + 60) }),
    ];
    const out = detectBusExceptions(rows, depots, FEED_NOW, stateOf(FEED_NOW));
    expect(out.map((e) => e.id)).toEqual([
      'emergency:Y1',
      'long_dark:X1',
      'tamper_code:A1',
      'tamper_code:B1',
      'tamper_code:Z1',
    ]);
  });
});

describe('buildExceptionReport', () => {
  it('caps the bus list but counts before the cap', () => {
    const n = BUS_EXCEPTION_CAP + 100;
    const rows = Array.from({ length: n }, (_, i) =>
      row({ registrationNumber: `R${String(i).padStart(4, '0')}`, mainPowerOn: false }),
    );
    rows.push(row({ registrationNumber: 'ZZZ', emergency: true }));
    const report = buildExceptionReport(rows, [depot({ fleet: n + 1 })], [score('1', {})], FEED_NOW, stateOf(FEED_NOW));
    expect(report.bus).toHaveLength(BUS_EXCEPTION_CAP);
    expect(report.busTotal).toBe(n + 1);
    expect(report.counts.power_cut).toBe(n);
    expect(report.counts.emergency).toBe(1);
    expect(report.counts.power_cut_cluster).toBe(1);
    // The most severe survive the cap.
    expect(report.bus[0]?.id).toBe('emergency:ZZZ');
  });

  it('reports every kind in counts, zero when absent', () => {
    const report = buildExceptionReport([], [], [], FEED_NOW, stateOf(FEED_NOW));
    expect(report).toEqual({
      depot: [],
      bus: [],
      busTotal: 0,
      counts: {
        dark_share_high: 0,
        off_road_high: 0,
        on_road_low: 0,
        power_cut_cluster: 0,
        long_dark: 0,
        power_cut: 0,
        tamper_code: 0,
        emergency: 0,
      },
    });
  });

  it('gives identical ids and order on shuffled input', () => {
    const depots = [depot(), depot({ id: '2', name: 'Barabanki' })];
    const rows = Array.from({ length: 40 }, (_, i) =>
      row({
        registrationNumber: `R${i}`,
        depotId: i % 2 === 0 ? '1' : '2',
        depotName: i % 2 === 0 ? 'Alambagh' : 'Barabanki',
        mainPowerOn: i % 3 !== 0,
        tamperCode: i % 5 === 0 ? 'W' : 'C',
        emergency: i % 7 === 0,
      }),
    );
    const scores = [score('2', {}), score('1', { dark: { value: 0.5, peerMedian: 0.1, z: -3 } })];
    const shuffled = [...rows].sort((a, b) => (a.registrationNumber.split('').reverse().join('') <
      b.registrationNumber.split('').reverse().join('') ? -1 : 1));
    const a = buildExceptionReport(rows, depots, scores, FEED_NOW, stateOf(FEED_NOW));
    const b = buildExceptionReport(shuffled, [...depots].reverse(), [...scores].reverse(), FEED_NOW, stateOf(FEED_NOW));
    expect(b).toEqual(a);
    expect(a.bus.length).toBeGreaterThan(0);
    expect(a.depot.length).toBeGreaterThan(0);
  });

  it('does not mutate its inputs', () => {
    const rows = Object.freeze([row({ mainPowerOn: false }), row({ registrationNumber: 'B', emergency: true })]);
    const depots = Object.freeze([depot()]);
    const scores = Object.freeze([score('1', {})]);
    const before = JSON.stringify([rows, depots, scores]);
    buildExceptionReport(rows, depots, scores, FEED_NOW, stateOf(FEED_NOW));
    expect(JSON.stringify([rows, depots, scores])).toBe(before);
  });
});
