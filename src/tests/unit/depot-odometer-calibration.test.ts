import { describe, it, expect } from 'vitest';
import type { DepotBusRow } from '@/models/depotLive';
import { fromMetres } from '@/lib/depot/infer/geo';
import {
  MIN_USABLE_PAIRS,
  calibrateOdometer,
  describeCalibration,
} from '@/lib/depot/maintenance/calibration';

const T0 = '2026-10-06T08:00:00Z';
const MINUTES = 10;
const T1 = new Date(Date.parse(T0) + MINUTES * 60_000).toISOString();
const HOME = { lat: 26.85, lng: 80.95 };
/** 5 km due east in the metre projection the app already uses. */
const FIVE_KM = fromMetres({ x: 5_000, y: 0 }, HOME.lat, HOME.lng);

function row(reg: string, over: Partial<DepotBusRow> = {}): DepotBusRow {
  return {
    registrationNumber: reg,
    latitude: HOME.lat,
    longitude: HOME.lng,
    speedKmph: 30,
    ignitionOn: true,
    gpsTimestamp: T0,
    receivedAt: T0,
    depotId: '1',
    depotName: 'Depot',
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
    odometerRaw: 1000,
    mainPowerOn: true,
    mainVoltage: null,
    tamperCode: null,
    emergency: null,
    ...over,
  };
}

/** n buses that each travel 5 km in 10 minutes and whose odometer grows by `grow`. */
function movers(n: number, grow: number): { first: DepotBusRow[]; second: DepotBusRow[] } {
  const ids = Array.from({ length: n }, (_, i) => `BUS${String(i).padStart(3, '0')}`);
  return {
    first: ids.map((id) => row(id)),
    second: ids.map((id) =>
      row(id, {
        latitude: FIVE_KM.lat,
        longitude: FIVE_KM.lng,
        gpsTimestamp: T1,
        odometerRaw: 1000 + grow,
      }),
    ),
  };
}

describe('calibrateOdometer', () => {
  it('reads a field that grows by about 5000 per 5 km as metres', () => {
    const { first, second } = movers(MIN_USABLE_PAIRS, 5_000);
    const report = calibrateOdometer(first, second);
    expect(report.usable).toBe(MIN_USABLE_PAIRS);
    expect(report.pathRatio?.median).toBeCloseTo(1000, -1);
    expect(report.reading).toBe('metres');
  });

  it('reads a field that grows by about 5 per 5 km as kilometres', () => {
    const { first, second } = movers(MIN_USABLE_PAIRS, 5);
    const report = calibrateOdometer(first, second);
    expect(report.pathRatio?.median).toBeCloseTo(1, 1);
    expect(report.reading).toBe('kilometres');
  });

  it('compares with the distance implied by the reported speed as well', () => {
    const { first, second } = movers(MIN_USABLE_PAIRS, 5);
    // 30 km/h for 10 minutes is 5 km.
    expect(calibrateOdometer(first, second).speedRatio?.median).toBeCloseTo(1, 1);
  });

  it('reports a ratio that fits neither unit as inconclusive', () => {
    const { first, second } = movers(MIN_USABLE_PAIRS, 40);
    expect(calibrateOdometer(first, second).reading).toBe('inconclusive');
  });

  it('excludes a stationary bus instead of dividing by its zero path', () => {
    const { first, second } = movers(MIN_USABLE_PAIRS, 5);
    first.push(row('STILL'));
    second.push(row('STILL', { gpsTimestamp: T1, odometerRaw: 1000 }));
    const report = calibrateOdometer(first, second);
    expect(report.excluded.stationary).toBe(1);
    expect(report.usable).toBe(MIN_USABLE_PAIRS);
    expect(Number.isFinite(report.pathRatio?.max)).toBe(true);
  });

  it('reports a bus whose distance went backwards separately', () => {
    const { first, second } = movers(MIN_USABLE_PAIRS, 5);
    first.push(row('BACK'));
    second.push(
      row('BACK', {
        latitude: FIVE_KM.lat,
        longitude: FIVE_KM.lng,
        gpsTimestamp: T1,
        odometerRaw: 400,
      }),
    );
    const report = calibrateOdometer(first, second);
    expect(report.backwards).toBe(1);
    expect(report.usable).toBe(MIN_USABLE_PAIRS);
  });

  it('says so when there are too few usable pairs and offers no reading', () => {
    const { first, second } = movers(MIN_USABLE_PAIRS - 1, 5);
    const report = calibrateOdometer(first, second);
    expect(report.reading).toBe('too_few');
    expect(describeCalibration(report).join('\n')).toContain('Too few usable pairs');
  });

  it('counts buses missing a distance, a position, a time or a partner', () => {
    const first = [
      row('A', { odometerRaw: null }),
      row('B', { latitude: null }),
      row('C'),
      row('D'),
    ];
    const second = [
      row('A', { gpsTimestamp: T1 }),
      row('B', { gpsTimestamp: T1 }),
      row('C', { gpsTimestamp: null }),
    ];
    const { excluded } = calibrateOdometer(first, second);
    expect(excluded.noDistance).toBe(1);
    expect(excluded.noPosition).toBe(1);
    expect(excluded.noTime).toBe(1);
    expect(excluded.unmatched).toBe(1);
  });

  it('excludes a pair whose fixes are too far apart in time', () => {
    const { first, second } = movers(MIN_USABLE_PAIRS, 5);
    const late = second.map((r) => ({ ...r, gpsTimestamp: '2026-10-06T12:00:00Z' }));
    const report = calibrateOdometer(first, late);
    expect(report.excluded.elapsedOutOfRange).toBe(MIN_USABLE_PAIRS);
    expect(report.reading).toBe('too_few');
  });

  it('does not mutate its inputs', () => {
    const { first, second } = movers(MIN_USABLE_PAIRS, 5);
    const before = JSON.stringify([first, second]);
    calibrateOdometer(first, second);
    expect(JSON.stringify([first, second])).toBe(before);
  });
});

describe('describeCalibration', () => {
  it('prints aggregates only and never a registration number', () => {
    const { first, second } = movers(MIN_USABLE_PAIRS, 5);
    const text = describeCalibration(calibrateOdometer(first, second)).join('\n');
    expect(text).not.toMatch(/BUS\d{3}/);
    expect(text).toContain('kilometres');
    expect(text).toContain('evidence');
  });
});
