// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { routeDayBoardings } from '@/lib/depot/service/routeDayBoardings';
import { SEATS_BY_CLASS } from '@/lib/depot/sim/config';
import { modelRidershipDay, modelLoadFactor } from '@/lib/depot/sim/ridership';
import { modelTripsPerDay } from '@/lib/depot/sim/tripFrequency';
import type { OperatingDay } from '@/lib/depot/sim/operatingDayTypes';

const DATE = '2026-10-06';
const ROUTE = 'VND_1613_ORD_OUT';

/** An operating day with one route that ran `trips` trips on ordinary buses. */
function dayWith(trips: number): OperatingDay {
  return {
    depotId: 'D1',
    operatingDate: DATE,
    duties: [],
    routesWithoutDuty: [],
    routes: [
      {
        routeName: ROUTE,
        serviceClass: 'ordinary',
        roundTripTenths: 1000,
        duties: trips,
        trips,
        serviceKm: trips * 100,
        seatsOffered: trips * SEATS_BY_CLASS.ordinary,
        lengthKm: 50,
        lengthProvenance: 'modelled',
      },
    ],
    runs: [],
    notRun: [],
    fleet: trips,
    availableBuses: trips,
    dutiesWithoutBus: 0,
    provenance: 'modelled',
  };
}

describe('routeDayBoardings: the route own buses turned into a day of boardings', () => {
  const input = { routeName: ROUTE, operatingDate: DATE, buses: 21, journeyMinutes: null } as const;
  const day = routeDayBoardings(input);

  it('takes the trips the Routes table shows for the same buses', () => {
    const trips = modelTripsPerDay({ routeName: ROUTE, buses: 21, scheduledDurationMin: null }, DATE);
    expect(day.trips).toBe(trips.tripsPerDay);
  });

  it('is trips x seats x the route load factor, by the revenue model rule (pinned)', () => {
    expect(day.seatsPerTrip).toBe(SEATS_BY_CLASS.ordinary);
    expect(day.loadFactor).toBe(modelLoadFactor(ROUTE, 'ordinary', DATE));
    // Two legs a trip, each carrying floor(seats x load factor / 0.45) boardings.
    const perLeg = Math.floor((day.seatsPerTrip * day.loadFactor) / 0.45);
    expect(day.boardings).toBe(day.trips * 2 * perLeg);
    expect({ trips: day.trips, loadFactor: day.loadFactor, boardings: day.boardings }).toEqual({
      trips: 34,
      loadFactor: 0.6,
      boardings: 4692, // 34 trips x 2 legs x floor(52 x 0.6 / 0.45) = 34 x 2 x 69
    });
  });

  it('equals the revenue model figure for the same route, date and trips', () => {
    const revenue = modelRidershipDay(dayWith(day.trips)).find((r) => r.routeName === ROUTE);
    expect(revenue?.boardings).toBe(day.boardings);
    expect(revenue?.loadFactor).toBe(day.loadFactor);
  });

  it('carries nobody without a bus, and more buses never carry fewer', () => {
    expect(routeDayBoardings({ ...input, buses: 0 }).boardings).toBe(0);
    expect(routeDayBoardings({ ...input, buses: 22 }).boardings).toBeGreaterThanOrEqual(day.boardings);
  });

  it('reads the class from the route name', () => {
    const express = routeDayBoardings({ ...input, routeName: 'AGRA_EXP_1' });
    expect(express.seatsPerTrip).toBe(SEATS_BY_CLASS.express);
  });
});
