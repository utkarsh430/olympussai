import { describe, expect, it } from 'vitest';
import { scheduledSupply } from '@/lib/depot/service/scheduledSupply';
import type { LedgerJourney, ScheduledTrip } from '@/lib/depot/service/types';

const DATE = '2026-10-06';
const ROUTE = 'AGRA_EXP_1';

function journey(over: Partial<LedgerJourney>): LedgerJourney {
  return {
    operatingDate: DATE, journeyId: 'j1', routeName: ROUTE, registrationNumber: 'UP1',
    scheduledStart: '07:00', scheduledEnd: '08:30', actualStart: null, delayMinutes: null,
    lastSeen: `${DATE}T07:10:00Z`, ...over,
  };
}

function trip(over: Partial<ScheduledTrip>): ScheduledTrip {
  return {
    forDate: DATE, answeredDate: DATE, registrationNumber: 'UP9', journeyId: 't1', journeyCode: null,
    routeName: ROUTE, startTime: '10:00', endTime: '11:00', stops: 12, ...over,
  };
}

describe('the scheduled supply of a route', () => {
  it('has no hours and no buses when nothing is known, so every hour reads as unknown', () => {
    const supply = scheduledSupply({
      routeName: ROUTE, operatingDate: DATE, ledger: [], trips: [], distinctBusesSeen: 4, busesWithDay: 0,
    });
    expect(supply.hours).toEqual([]);
    expect(supply.coverage).toEqual({ n: 0, of: 4 });
  });

  it('places the feed journeys alone and says so; one journey is no bus day', () => {
    const supply = scheduledSupply({
      routeName: ROUTE, operatingDate: DATE, ledger: [journey({})], trips: [], distinctBusesSeen: 3,
      busesWithDay: 0,
    });
    expect(supply.hours).toHaveLength(24);
    expect(supply.hours[7]).toMatchObject({ tripsStarting: 1, busHours: 1, fromFeedRowsOnly: true });
    expect(supply.hours[8]).toMatchObject({ tripsStarting: 0, busHours: 0.5 });
    expect(supply.coverage).toEqual({ n: 0, of: 3 });
    expect(supply.hours[7]?.coverage).toEqual({ n: 0, of: 3 });
  });

  it('adds the loaded timetable trips the feed did not report, counting each bus once', () => {
    const supply = scheduledSupply({
      routeName: ROUTE,
      operatingDate: DATE,
      ledger: [journey({}), journey({ journeyId: 'j2', routeName: 'OTHER' })],
      trips: [
        trip({}),
        trip({ journeyId: 'j1', registrationNumber: 'UP1', startTime: '07:00', endTime: '08:30' }),
        trip({ journeyId: 't2', forDate: '2026-10-05' }),
        trip({ journeyId: 't3', routeName: 'OTHER' }),
      ],
      distinctBusesSeen: 1,
      busesWithDay: 2,
    });
    expect(supply.hours[7]?.tripsStarting).toBe(1);
    expect(supply.hours[10]).toMatchObject({ tripsStarting: 1, busHours: 1, fromFeedRowsOnly: false });
    // Two bus days recorded, though one bus was seen: never fewer seen than are known.
    expect(supply.coverage).toEqual({ n: 2, of: 2 });
  });

  it('leaves out a journey of another date', () => {
    const supply = scheduledSupply({
      routeName: ROUTE, operatingDate: DATE, ledger: [journey({ operatingDate: '2026-10-05' })],
      trips: [], distinctBusesSeen: 0, busesWithDay: 0,
    });
    expect(supply.hours).toEqual([]);
    expect(supply.coverage).toEqual({ n: 0, of: 0 });
  });
});
