import { describe, expect, it } from 'vitest';
import type { DepotBusRow } from '@/models/depotLive';
import { UNASSIGNED_DEPOT_ID, type DepotSummary } from '@/lib/depot/types';
import { classifyDepotKind } from '@/lib/depot/live/depotKind';
import { networkKpis, summariseDepots } from '@/lib/depot/live/aggregate';
import { fieldCoverage } from '@/lib/depot/live/coverage';

const FEED_NOW = '2026-10-06T12:00:00.000Z';

function minutesFromNow(minutes: number): string {
  return new Date(Date.parse(FEED_NOW) + minutes * 60_000).toISOString();
}

let serial = 0;
function makeRow(overrides: Partial<DepotBusRow> = {}): DepotBusRow {
  serial += 1;
  return {
    registrationNumber: `UP00X${String(serial).padStart(4, '0')}`,
    latitude: 26.8,
    longitude: 80.9,
    speedKmph: 0,
    ignitionOn: true,
    gpsTimestamp: minutesFromNow(-1),
    receivedAt: minutesFromNow(-1),
    depotId: '10',
    depotName: 'ALAMBAGH',
    vehicleStatus: 'live',
    tripStatus: 'Live',
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
    emergency: null,
    ...overrides,
  };
}

function rowsOf(count: number, overrides: Partial<DepotBusRow> = {}): DepotBusRow[] {
  return Array.from({ length: count }, () => makeRow(overrides));
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

/** Every number anywhere inside a value. JSON.stringify would hide NaN as null. */
function collectNumbers(value: unknown): number[] {
  if (typeof value === 'number') return [value];
  if (value === null || typeof value !== 'object') return [];
  return Object.values(value).flatMap(collectNumbers);
}

function expectAllNumbersFinite(value: unknown): void {
  const numbers = collectNumbers(value);
  expect(numbers.filter((n) => !Number.isFinite(n))).toEqual([]);
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function onlyDepot(rows: readonly DepotBusRow[], feedNow: string | null = FEED_NOW): DepotSummary {
  const summaries = summariseDepots(rows, feedNow);
  expect(summaries).toHaveLength(1);
  return summaries[0] as DepotSummary;
}

describe('classifyDepotKind', () => {
  it.each([
    ['BAREILLY(R)', 'depot'],
    ['ENFORCEMENT_HQ', 'enforcement'],
    ['enforcement_ayodhya', 'enforcement'],
    ['KAISERBAGH HIRED', 'hired'],
    ['NOIDA ELECTRIC', 'electric'],
    [null, 'unassigned'],
    ['', 'unassigned'],
    ['HIREDABAD', 'depot'],
  ] as const)('%s is %s', (name, kind) => {
    expect(classifyDepotKind(name)).toBe(kind);
  });
});

describe('summariseDepots', () => {
  it('returns [] for empty input', () => {
    expect(summariseDepots([], FEED_NOW)).toEqual([]);
  });

  it('counts status, assigned, power cut and tamper flags', () => {
    const rows = [
      makeRow({ vehicleStatus: 'live', routeName: 'R1' }),
      makeRow({ vehicleStatus: 'live', mainPowerOn: false }),
      makeRow({ vehicleStatus: 'stationary', tamperCode: 'W' }),
      makeRow({ vehicleStatus: 'no_signal', tamperCode: null, mainPowerOn: null }),
      makeRow({ vehicleStatus: 'under_maintenance' }),
      makeRow({ vehicleStatus: 'unknown' }),
    ];
    const depot = onlyDepot(rows);
    expect(depot.fleet).toBe(6);
    expect(depot.status).toEqual({
      live: 2,
      stationary: 1,
      noSignal: 1,
      underMaintenance: 1,
      unknown: 1,
    });
    expect(depot.assigned).toBe(1);
    expect(depot.powerCut).toBe(1);
    expect(depot.tamperFlagged).toBe(1);
    expect(depot.kind).toBe('depot');
  });

  it('fills the state mix from bus state classification', () => {
    const rows = [
      makeRow({ speedKmph: 30, routeName: 'R1', scheduledStart: '2026-10-06T08:00:00.000Z' }),
      makeRow({ speedKmph: 30 }),
      makeRow({ speedKmph: 0 }),
      makeRow({ vehicleStatus: 'no_signal' }),
      makeRow({ vehicleStatus: 'under_maintenance' }),
    ];
    expect(onlyDepot(rows).states).toEqual({
      inService: 1,
      onRoad: 1,
      standing: 1,
      dark: 1,
      offRoad: 1,
    });
  });

  it('keeps state counts and status counts equal to fleet across mixed rows', () => {
    const rows = [
      ...rowsOf(3, { speedKmph: 20, routeName: 'R' }),
      ...rowsOf(2, { gpsTimestamp: null, vehicleStatus: 'unknown' }),
      ...rowsOf(2, { vehicleStatus: 'under_maintenance', speedKmph: null }),
      ...rowsOf(1, { gpsTimestamp: 'bad', speedKmph: 50 }),
      ...rowsOf(2, { depotId: null, depotName: null, vehicleStatus: 'stationary' }),
    ];
    for (const feedNow of [FEED_NOW, null]) {
      for (const depot of summariseDepots(rows, feedNow)) {
        expect(sum(Object.values(depot.states))).toBe(depot.fleet);
        expect(sum(Object.values(depot.status))).toBe(depot.fleet);
      }
    }
  });

  it('puts null-depot rows in one unassigned bucket', () => {
    const rows = [
      makeRow({ depotId: null, depotName: null }),
      makeRow({ depotId: null, depotName: 'STRAY' }),
      makeRow(),
    ];
    const unassigned = summariseDepots(rows, FEED_NOW).find((d) => d.id === UNASSIGNED_DEPOT_ID);
    expect(unassigned).toMatchObject({ name: 'Unassigned', kind: 'unassigned', fleet: 2 });
  });

  it('names a depot by its most frequent depotName', () => {
    const rows = [
      makeRow({ depotName: 'ALAMBAGH' }),
      makeRow({ depotName: 'ALAMBAGH (OLD)' }),
      makeRow({ depotName: 'ALAMBAGH' }),
    ];
    expect(onlyDepot(rows).name).toBe('ALAMBAGH');
  });

  it('breaks a name tie alphabetically and falls back when no row has a name', () => {
    const tie = [makeRow({ depotName: 'B DEPOT' }), makeRow({ depotName: 'A DEPOT' })];
    expect(onlyDepot(tie).name).toBe('A DEPOT');
    expect(onlyDepot([makeRow({ depotName: null })]).name).toBe('Depot 10');
  });

  it('derives kind from the depot name', () => {
    const rows = [
      makeRow({ depotId: '1', depotName: 'ENFORCEMENT_HQ' }),
      makeRow({ depotId: '2', depotName: 'NOIDA ELECTRIC' }),
    ];
    const kinds = summariseDepots(rows, FEED_NOW).map((d) => d.kind).sort();
    expect(kinds).toEqual(['electric', 'enforcement']);
  });

  describe('reporting window', () => {
    it.each([
      ['exactly 30 min behind', -30, 1],
      ['31 min behind', -31, 0],
      ['exactly 30 min ahead', 30, 1],
      ['31 min ahead', 31, 0],
    ] as const)('%s', (_label, offset, expected) => {
      const depot = onlyDepot([makeRow({ gpsTimestamp: minutesFromNow(offset) })]);
      expect(depot.reporting).toBe(expected);
    });

    it('is 0 when feedNow is null', () => {
      expect(onlyDepot(rowsOf(3), null).reporting).toBe(0);
    });

    it('does not count a missing or invalid timestamp', () => {
      const rows = [makeRow({ gpsTimestamp: 'not-a-time' }), makeRow({ gpsTimestamp: null })];
      expect(onlyDepot(rows).reporting).toBe(0);
    });

    it('is 0 when feedNow itself is unparsable', () => {
      expect(onlyDepot(rowsOf(2), 'garbage').reporting).toBe(0);
    });
  });

  describe('positions', () => {
    it('counts only rows with a full valid position', () => {
      const rows = [
        makeRow(),
        makeRow({ latitude: null, longitude: null }),
        makeRow({ latitude: 26, longitude: null }),
      ];
      expect(onlyDepot(rows).positioned).toBe(1);
    });

    it('centroid is the per-axis median (odd count)', () => {
      const rows = [
        makeRow({ latitude: 10, longitude: 100 }),
        makeRow({ latitude: 30, longitude: 120 }),
        makeRow({ latitude: 20, longitude: 90 }),
      ];
      expect(onlyDepot(rows).centroid).toEqual({ lat: 20, lng: 100 });
    });

    it('centroid is the mean of the middle two (even count)', () => {
      const rows = [
        makeRow({ latitude: 10, longitude: 80 }),
        makeRow({ latitude: 20, longitude: 82 }),
      ];
      expect(onlyDepot(rows).centroid).toEqual({ lat: 15, lng: 81 });
    });

    it('centroid ignores a (0, 0) fix, which is a device with no fix and not a place', () => {
      const rows = [
        makeRow({ latitude: 26, longitude: 80 }),
        makeRow({ latitude: 0, longitude: 0 }),
        makeRow({ latitude: 0, longitude: 0 }),
      ];
      expect(onlyDepot(rows).centroid).toEqual({ lat: 26, lng: 80 });
      expect(onlyDepot([makeRow({ latitude: 0, longitude: 0 })]).centroid).toBeNull();
    });

    it('centroid is null with no positions', () => {
      const rows = [makeRow({ latitude: null, longitude: null })];
      expect(onlyDepot(rows).centroid).toBeNull();
    });
  });

  it('orders by fleet descending then name', () => {
    const rows = [
      ...rowsOf(1, { depotId: '3', depotName: 'ZED' }),
      ...rowsOf(2, { depotId: '2', depotName: 'BETA' }),
      ...rowsOf(2, { depotId: '1', depotName: 'ALPHA' }),
      ...rowsOf(3, { depotId: '4', depotName: 'OMEGA' }),
    ];
    expect(summariseDepots(rows, FEED_NOW).map((d) => d.name)).toEqual([
      'OMEGA',
      'ALPHA',
      'BETA',
      'ZED',
    ]);
  });

  it('output order does not depend on input order', () => {
    const rows = [
      ...rowsOf(2, { depotId: '2', depotName: 'BETA' }),
      ...rowsOf(2, { depotId: '1', depotName: 'ALPHA' }),
    ];
    const forward = summariseDepots(rows, FEED_NOW).map((d) => d.id);
    const backward = summariseDepots([...rows].reverse(), FEED_NOW).map((d) => d.id);
    expect(backward).toEqual(forward);
  });

  it('does not mutate deep-frozen input', () => {
    const rows = deepFreeze([...rowsOf(3, { speedKmph: 20 }), makeRow({ depotId: null })]);
    expect(() => summariseDepots(rows, FEED_NOW)).not.toThrow();
  });

});

describe('collectNumbers (test helper)', () => {
  it('finds numbers in nested objects and arrays, including NaN and Infinity', () => {
    const found = collectNumbers({ a: 1, b: [2, { c: Number.NaN }], d: { e: Infinity }, f: 'x' });
    expect(found).toHaveLength(4);
    expect(found.filter((n) => !Number.isFinite(n))).toHaveLength(2);
  });

  it('makes the finite assertion fail on a NaN or Infinity', () => {
    expect(() => expectAllNumbersFinite({ deep: [{ lat: Number.NaN }] })).toThrow();
    expect(() => expectAllNumbersFinite({ value: -Infinity })).toThrow();
    expect(() => expectAllNumbersFinite({ value: 1, list: [0, 2.5] })).not.toThrow();
  });

  it('actually visits numbers in real output (centroid included)', () => {
    const depots = summariseDepots([makeRow({ latitude: 10, longitude: 20 })], FEED_NOW);
    expect(collectNumbers(depots)).toEqual(expect.arrayContaining([10, 20]));
  });
});

describe('non-finite numbers', () => {
  const scenarios: ReadonlyArray<readonly [string, readonly DepotBusRow[], string | null]> = [
    ['empty input', [], FEED_NOW],
    ['no positions anywhere', rowsOf(3, { latitude: null, longitude: null }), FEED_NOW],
    ['positions present (centroid computed)', [
      makeRow({ latitude: 10, longitude: 80 }),
      makeRow({ latitude: 20, longitude: 82 }),
      makeRow({ latitude: 30, longitude: 84 }),
    ], FEED_NOW],
    ['null feedNow', rowsOf(3, { speedKmph: 20 }), null],
    ['unparsable feedNow and timestamps', rowsOf(2, { gpsTimestamp: 'bad' }), 'garbage'],
    ['every bus off road', rowsOf(4, { vehicleStatus: 'under_maintenance', speedKmph: null }), FEED_NOW],
    ['only unassigned buses', rowsOf(2, { depotId: null, depotName: null }), FEED_NOW],
  ];

  it.each(scenarios)('summariseDepots, networkKpis and fieldCoverage stay finite: %s', (
    _name,
    rows,
    feedNow,
  ) => {
    const depots = summariseDepots(rows, feedNow);
    expectAllNumbersFinite(depots);
    expectAllNumbersFinite(networkKpis(depots));
    expectAllNumbersFinite(fieldCoverage(rows));
  });
});

describe('networkKpis', () => {
  const rows = [
    ...rowsOf(3, { depotId: '1', depotName: 'ALPHA', routeName: 'R1', gpsTimestamp: minutesFromNow(-1) }),
    ...rowsOf(2, { depotId: '1', depotName: 'ALPHA', vehicleStatus: 'stationary' }),
    ...rowsOf(1, { depotId: '1', depotName: 'ALPHA', vehicleStatus: 'no_signal' }),
    ...rowsOf(1, { depotId: '2', depotName: 'BETA', vehicleStatus: 'under_maintenance' }),
    ...rowsOf(2, { depotId: '3', depotName: 'ENFORCEMENT_HQ' }),
    ...rowsOf(1, { depotId: null, depotName: null, gpsTimestamp: null }),
  ];
  const summaries = summariseDepots(rows, FEED_NOW);
  const kpis = networkKpis(summaries);
  const stateTotal = (pick: (s: (typeof summaries)[number]['states']) => number): number =>
    summaries.reduce((total, depot) => total + pick(depot.states), 0);

  it('totals every bucket', () => {
    expect(kpis.fleet.value).toBe(10);
    expect(kpis.assigned.value).toBe(3);
    expect(kpis.reporting.value).toBe(9);
  });

  it('counts bus states the way every depot page does, so a network total is the sum of its depots', () => {
    // One vocabulary on screen: the classified states, not the feed's own status field.
    // The overview's "On road" for a depot must equal that depot's cockpit and roster.
    expect(kpis.onRoad.value).toBe(stateTotal((s) => s.inService + s.onRoad));
    expect(kpis.stationary.value).toBe(stateTotal((s) => s.standing));
    expect(kpis.noSignal.value).toBe(stateTotal((s) => s.dark));
    expect(kpis.underMaintenance.value).toBe(stateTotal((s) => s.offRoad));
  });

  it('partitions the fleet: every bus is in exactly one of the four state totals', () => {
    expect(
      kpis.onRoad.value +
        kpis.stationary.value +
        kpis.noSignal.value +
        kpis.underMaintenance.value,
    ).toBe(kpis.fleet.value);
  });

  it('counts a bus with no position time as dark, whatever the feed calls it', () => {
    // The one row with `gpsTimestamp: null` carries the feed's default status, yet it is dark.
    expect(kpis.noSignal.value).toBeGreaterThanOrEqual(2);
  });

  it('counts only real depots in depots', () => {
    expect(kpis.depots.value).toBe(2);
  });

  it('assigns provenance', () => {
    expect(kpis.fleet.provenance).toBe('live');
    // Classified from speed, position age and status: computed, so DERIVED.
    expect(kpis.onRoad.provenance).toBe('derived');
    expect(kpis.stationary.provenance).toBe('derived');
    expect(kpis.noSignal.provenance).toBe('derived');
    expect(kpis.underMaintenance.provenance).toBe('derived');
    expect(kpis.reporting.provenance).toBe('derived');
    expect(kpis.assigned.provenance).toBe('derived');
    expect(kpis.depots.provenance).toBe('derived');
  });

  it('carries coverage of the fleet total on count figures', () => {
    for (const figure of [kpis.fleet, kpis.reporting, kpis.onRoad, kpis.stationary]) {
      expect(figure.coverage).toEqual({ n: figure.value, of: 10 });
    }
    expect(kpis.noSignal.coverage).toEqual({ n: kpis.noSignal.value, of: 10 });
    expect(kpis.underMaintenance.coverage).toEqual({ n: kpis.underMaintenance.value, of: 10 });
    expect(kpis.assigned.coverage).toEqual({ n: 3, of: 10 });
  });

  it('yields zeros and no NaN for empty input', () => {
    const empty = networkKpis([]);
    for (const figure of Object.values(empty)) {
      expect(figure.value).toBe(0);
      expect(figure.coverage?.of ?? 0).toBe(0);
    }
    expectAllNumbersFinite(empty);
  });

  it('does not mutate deep-frozen input', () => {
    const depots = deepFreeze(summariseDepots(rows, FEED_NOW));
    expect(() => networkKpis(depots)).not.toThrow();
  });
});
