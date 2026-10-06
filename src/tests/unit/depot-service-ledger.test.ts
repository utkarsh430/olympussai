// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { DepotBusRow } from '@/models/depotLive';
import {
  feedDigitsOn,
  ledgerJourneysOf,
  mergeJourneys,
  scheduledHoursFromLedger,
} from '@/lib/depot/service/journeyLedger';
import type { LedgerJourney } from '@/lib/depot/service/types';

const DATE = '2026-10-06';
const FEED_NOW = '2026-10-06T10:00:00.000Z';

function row(partial: Partial<DepotBusRow>): DepotBusRow {
  return {
    registrationNumber: 'UP01AA0001',
    routeName: 'R1',
    journeyId: 'J1',
    scheduledStart: null,
    scheduledEnd: null,
    actualStart: null,
    delayMinutes: null,
    ...partial,
  } as DepotBusRow;
}

function journey(partial: Partial<LedgerJourney>): LedgerJourney {
  return {
    operatingDate: DATE,
    journeyId: 'J1',
    routeName: 'R1',
    registrationNumber: 'UP01AA0001',
    scheduledStart: null,
    scheduledEnd: null,
    actualStart: null,
    delayMinutes: null,
    lastSeen: FEED_NOW,
    ...partial,
  };
}

describe('feedDigitsOn', () => {
  it('reads HH:MM off a feed time of the operating date, as the normaliser leaves it', () => {
    expect(feedDigitsOn('2026-10-06T06:20:00.000Z', DATE)).toBe('06:20');
    expect(feedDigitsOn('2026-10-06T23:59:59Z', DATE)).toBe('23:59');
    expect(feedDigitsOn('07:05', DATE)).toBe('07:05');
    expect(feedDigitsOn('07:05:30', DATE)).toBe('07:05');
  });

  it('gives null for another date, an absent time or a malformed one', () => {
    expect(feedDigitsOn('2026-10-05T23:20:00.000Z', DATE)).toBeNull();
    expect(feedDigitsOn(null, DATE)).toBeNull();
    expect(feedDigitsOn('', DATE)).toBeNull();
    expect(feedDigitsOn('2026-10-06T24:10:00Z', DATE)).toBeNull();
    expect(feedDigitsOn('7:5', DATE)).toBeNull();
    expect(feedDigitsOn('late', DATE)).toBeNull();
  });
});

describe('ledgerJourneysOf', () => {
  it('keeps every journey the rows report with a route name, times as feed digits', () => {
    const rows = [
      row({
        registrationNumber: 'UP01AA0002',
        journeyId: '8073',
        routeName: 'CBG_583_ORD_OUT',
        scheduledStart: '2026-10-06T09:30:00.000Z',
        scheduledEnd: '2026-10-06T15:59:50.000Z',
        actualStart: '2026-10-06T10:44:36.000Z',
        delayMinutes: 29.1,
      }),
      row({ journeyId: null }),
      row({ journeyId: 'J9', routeName: null }),
      row({ journeyId: 'J8', routeName: '  ' }),
      row({ journeyId: 'J7', scheduledStart: 'garbage', delayMinutes: Number.NaN }),
    ];
    expect(ledgerJourneysOf(rows, DATE, FEED_NOW)).toEqual([
      {
        operatingDate: DATE,
        journeyId: '8073',
        routeName: 'CBG_583_ORD_OUT',
        registrationNumber: 'UP01AA0002',
        scheduledStart: '09:30',
        scheduledEnd: '15:59',
        actualStart: '10:44',
        delayMinutes: 29.1,
        lastSeen: FEED_NOW,
      },
      journey({ journeyId: 'J7' }),
    ]);
  });
});

describe('mergeJourneys', () => {
  it('keeps the newest sighting per journey id and leaves the previous map alone', () => {
    const previous = new Map([
      ['J1', journey({ delayMinutes: 3, lastSeen: '2026-10-06T09:00:00.000Z' })],
      ['J2', journey({ journeyId: 'J2', delayMinutes: 4, lastSeen: '2026-10-06T11:00:00.000Z' })],
    ]);
    const merged = mergeJourneys(previous, [
      journey({ delayMinutes: 5 }),
      journey({ journeyId: 'J2', delayMinutes: 6 }),
      journey({ journeyId: 'J3' }),
    ]);
    expect(merged.get('J1')?.delayMinutes).toBe(5);
    expect(merged.get('J2')?.delayMinutes).toBe(4);
    expect([...merged.keys()].sort()).toEqual(['J1', 'J2', 'J3']);
    expect(previous.get('J1')?.delayMinutes).toBe(3);
    expect(previous.has('J3')).toBe(false);
  });

  it('keeps the held sighting on an equal time, and holds no more than the cap', () => {
    const previous = new Map([['J1', journey({ delayMinutes: 3 })]]);
    const merged = mergeJourneys(previous, [
      journey({ delayMinutes: 9 }),
      journey({ journeyId: 'J2' }),
      journey({ journeyId: 'J3' }),
    ], 2);
    expect(merged.get('J1')?.delayMinutes).toBe(3);
    expect([...merged.keys()]).toEqual(['J1', 'J2']);
  });
});

describe('scheduledHoursFromLedger', () => {
  const coverage = { n: 3, of: 10 };

  it('counts trips starting per hour and bus-hours across an hour boundary', () => {
    const hours = scheduledHoursFromLedger('R1', DATE, [
      journey({ scheduledStart: '07:30', scheduledEnd: '09:15' }),
      journey({ journeyId: 'J2', scheduledStart: '08:00', scheduledEnd: '08:30' }),
      journey({ journeyId: 'J3', routeName: 'R2', scheduledStart: '08:00', scheduledEnd: '09:00' }),
      journey({ journeyId: 'J4', operatingDate: '2026-10-05', scheduledStart: '08:00' }),
    ], coverage);
    expect(hours).toHaveLength(24);
    expect(hours.every((h) => h.fromFeedRowsOnly && h.coverage === coverage)).toBe(true);
    expect(hours[7]).toEqual({
      routeName: 'R1',
      operatingDate: DATE,
      hour: 7,
      tripsStarting: 1,
      busHours: 0.5,
      coverage,
      fromFeedRowsOnly: true,
    });
    expect(hours[8]).toMatchObject({ tripsStarting: 1, busHours: 1.5 });
    expect(hours[9]).toMatchObject({ tripsStarting: 0, busHours: 0.25 });
    expect(hours[10]).toMatchObject({ tripsStarting: 0, busHours: 0 });
  });

  it('counts a journey without a usable end in its start hour only, from its start', () => {
    const hours = scheduledHoursFromLedger('R1', DATE, [
      journey({ scheduledStart: '18:40', scheduledEnd: null }),
      journey({ journeyId: 'J2', scheduledStart: '18:10', scheduledEnd: '18:05' }),
      journey({ journeyId: 'J3', scheduledStart: null, scheduledEnd: '19:30' }),
    ], coverage);
    // 20 minutes of the open journey and 50 of the one whose end precedes its start.
    expect(hours[18]).toMatchObject({ tripsStarting: 2, busHours: 1.17 });
    expect(hours[19]).toMatchObject({ tripsStarting: 0, busHours: 0 });
  });
});
