import { describe, expect, it } from 'vitest';
import type { DepotBusRow } from '@/models/depotLive';
import { classifyBusState, gpsAgeMinutes } from '@/lib/depot/infer/busState';

const FEED_NOW = '2026-10-06T12:00:00.000Z';

function minutesBefore(minutes: number): string {
  return new Date(Date.parse(FEED_NOW) - minutes * 60_000).toISOString();
}

function makeRow(overrides: Partial<DepotBusRow> = {}): DepotBusRow {
  return {
    registrationNumber: 'UP00X0001',
    latitude: 26.8,
    longitude: 80.9,
    speedKmph: 0,
    ignitionOn: true,
    gpsTimestamp: minutesBefore(1),
    receivedAt: minutesBefore(1),
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

describe('gpsAgeMinutes', () => {
  it('returns minutes between fix and feed time', () => {
    expect(gpsAgeMinutes(makeRow({ gpsTimestamp: minutesBefore(90) }), FEED_NOW)).toBe(90);
    expect(gpsAgeMinutes(makeRow({ gpsTimestamp: minutesBefore(0.5) }), FEED_NOW)).toBe(0.5);
  });

  it('is null when either time is missing', () => {
    expect(gpsAgeMinutes(makeRow({ gpsTimestamp: null }), FEED_NOW)).toBeNull();
    expect(gpsAgeMinutes(makeRow(), null)).toBeNull();
  });

  it('is null when either time is unparsable', () => {
    expect(gpsAgeMinutes(makeRow({ gpsTimestamp: 'not a time' }), FEED_NOW)).toBeNull();
    expect(gpsAgeMinutes(makeRow(), 'garbage')).toBeNull();
  });

  it('clamps a device clock running ahead to 0', () => {
    expect(gpsAgeMinutes(makeRow({ gpsTimestamp: minutesBefore(-5) }), FEED_NOW)).toBe(0);
  });
});

type Case = readonly [string, Partial<DepotBusRow>, string | null, string];

describe('classifyBusState', () => {
  const cases: readonly Case[] = [
    ['maintenance beats movement', { vehicleStatus: 'under_maintenance', speedKmph: 40, routeName: 'R1' }, FEED_NOW, 'off_road'],
    ['maintenance beats a missing fix', { vehicleStatus: 'under_maintenance', gpsTimestamp: null }, FEED_NOW, 'off_road'],
    ['no_signal is dark', { vehicleStatus: 'no_signal' }, FEED_NOW, 'dark'],
    ['no_signal is dark with null feedNow', { vehicleStatus: 'no_signal' }, null, 'dark'],
    ['no fix time is dark', { gpsTimestamp: null }, FEED_NOW, 'dark'],
    ['age exactly 360 min is not dark', { gpsTimestamp: minutesBefore(360) }, FEED_NOW, 'standing'],
    ['age 361 min is dark', { gpsTimestamp: minutesBefore(361) }, FEED_NOW, 'dark'],
    ['stale fix overrides movement', { gpsTimestamp: minutesBefore(500), speedKmph: 50, routeName: 'R1' }, FEED_NOW, 'dark'],
    ['null feedNow cannot age a fix out', { gpsTimestamp: minutesBefore(5000), speedKmph: 20 }, null, 'on_road'],
    ['moving with a route is in service', { speedKmph: 30, routeName: 'LKO-KNP' }, FEED_NOW, 'in_service'],
    ['moving without a route is on road', { speedKmph: 30, routeName: null }, FEED_NOW, 'on_road'],
    ['speed exactly 3 is standing', { speedKmph: 3, routeName: 'R1' }, FEED_NOW, 'standing'],
    ['speed just above 3 is moving', { speedKmph: 3.1, routeName: 'R1' }, FEED_NOW, 'in_service'],
    ['null speed is standing', { speedKmph: null, routeName: 'R1' }, FEED_NOW, 'standing'],
    ['stationary and fresh is standing', { vehicleStatus: 'stationary' }, FEED_NOW, 'standing'],
    ['unparsable fix time cannot age out', { gpsTimestamp: 'bad', speedKmph: 20 }, FEED_NOW, 'on_road'],
  ];

  it.each(cases)('%s', (_name, overrides, feedNow, expected) => {
    expect(classifyBusState(makeRow(overrides), feedNow)).toBe(expected);
  });

  it('does not mutate a frozen row', () => {
    const row = Object.freeze(makeRow({ speedKmph: 20, routeName: 'R1' }));
    expect(classifyBusState(row, FEED_NOW)).toBe('in_service');
    expect(gpsAgeMinutes(row, FEED_NOW)).toBe(1);
  });
});
