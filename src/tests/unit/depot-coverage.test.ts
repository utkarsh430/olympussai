import { describe, expect, it } from 'vitest';
import type { DepotBusRow } from '@/models/depotLive';
import { fieldCoverage } from '@/lib/depot/live/coverage';

function makeRow(overrides: Partial<DepotBusRow> = {}): DepotBusRow {
  return {
    registrationNumber: 'UP00X0001',
    latitude: null,
    longitude: null,
    speedKmph: null,
    ignitionOn: null,
    gpsTimestamp: null,
    receivedAt: null,
    depotId: null,
    depotName: null,
    vehicleStatus: 'unknown',
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
    mainPowerOn: null,
    mainVoltage: null,
    tamperCode: null,
    emergency: null,
    ...overrides,
  };
}

const EXPECTED_ORDER = [
  'depotId',
  'position',
  'vehicleStatus',
  'gpsTimestamp',
  'routeName',
  'scheduledStart',
  'actualStart',
  'delayMinutes',
  'odometerRaw',
  'mainPowerOn',
  'tamperCode',
];

describe('fieldCoverage', () => {
  it('reports every field in the documented order with a label', () => {
    const coverage = fieldCoverage([makeRow()]);
    expect(coverage.map((c) => c.field)).toEqual(EXPECTED_ORDER);
    for (const entry of coverage) expect(entry.label.length).toBeGreaterThan(0);
  });

  it('counts populated fields over a hand-built set', () => {
    const rows = [
      makeRow({
        depotId: '1',
        latitude: 26,
        longitude: 80,
        vehicleStatus: 'live',
        gpsTimestamp: '2026-10-06T12:00:00Z',
        routeName: 'R1',
        scheduledStart: '2026-10-06T10:00:00Z',
        actualStart: '2026-10-06T10:05:00Z',
        delayMinutes: 5,
        odometerRaw: 100,
        mainPowerOn: true,
        tamperCode: 'C',
      }),
      makeRow({ depotId: '2', latitude: 26, longitude: null, vehicleStatus: 'stationary' }),
      makeRow({ delayMinutes: 0, mainPowerOn: false, vehicleStatus: 'unknown' }),
      makeRow({ latitude: 27, longitude: 81, odometerRaw: 0, tamperCode: 'W' }),
    ];
    const byField = Object.fromEntries(fieldCoverage(rows).map((c) => [c.field, c.populated]));
    expect(byField).toEqual({
      depotId: 2,
      position: 2,
      vehicleStatus: 2,
      gpsTimestamp: 1,
      routeName: 1,
      scheduledStart: 1,
      actualStart: 1,
      delayMinutes: 2,
      odometerRaw: 2,
      mainPowerOn: 2,
      tamperCode: 2,
    });
    for (const entry of fieldCoverage(rows)) expect(entry.of).toBe(4);
  });

  it('gives populated 0 and of 0 for empty input', () => {
    const coverage = fieldCoverage([]);
    expect(coverage).toHaveLength(EXPECTED_ORDER.length);
    for (const entry of coverage) {
      expect(entry.populated).toBe(0);
      expect(entry.of).toBe(0);
    }
  });

  it('does not mutate deep-frozen input', () => {
    const rows = Object.freeze([Object.freeze(makeRow({ depotId: '1' }))]);
    expect(fieldCoverage(rows)[0]?.populated).toBe(1);
  });

  it('never exceeds of and never yields NaN', () => {
    const coverage = fieldCoverage([makeRow(), makeRow({ depotId: '1' })]);
    for (const entry of coverage) {
      expect(entry.populated).toBeLessThanOrEqual(entry.of);
      expect(Number.isFinite(entry.populated)).toBe(true);
      expect(Number.isFinite(entry.of)).toBe(true);
    }
  });
});
