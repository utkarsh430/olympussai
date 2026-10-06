import { describe, expect, it } from 'vitest';
import type { DepotBusView } from '@/lib/depot/api';
import { analyseRevenue } from '@/lib/depot/revenue/analysis';
import { modelOperatingDay } from '@/lib/depot/sim/operatingDay';
import type { OperatingDay } from '@/lib/depot/sim/operatingDayTypes';
import {
  AVG_TRIP_LENGTH_SHARE,
  FARE_PER_KM,
  LOAD_FACTOR_BASE,
  LOAD_FACTOR_DAILY_NOISE,
  LOAD_FACTOR_ROUTE_SPREAD,
  MAX_LOAD_FACTOR,
} from '@/lib/depot/sim/revenueConfig';
import { modelRidershipDay } from '@/lib/depot/sim/ridership';
import { priceRoute } from '@/lib/depot/sim/ridershipFigures';
import type { BusOpState, DepotSummary } from '@/lib/depot/types';

/*
 * The old tests pinned trips taken from the
 * trip-frequency model, a flat fare for a route of unknown length and earnings
 * per kilometre withheld as `unknown_length`. Trips are now the operating day's
 * duties that ran, every route is priced on a length (real or modelled), and
 * earnings per kilometre are given for every route that ran.
 */

const DEPOT = { id: '7', name: 'Kaushambi', kind: 'depot', fleet: 24 } as unknown as DepotSummary;

function bus(registrationNumber: string, state: BusOpState, routeName: string | null): DepotBusView {
  // Heard a minute ago, in the yard: a standing bus is then eligible for a duty.
  return {
    registrationNumber, state, routeName, location: 'in_yard', gpsAgeMin: 1, notHeardMin: null,
  } as unknown as DepotBusView;
}

const BUSES = Array.from({ length: 24 }, (_, i) =>
  bus(`UP70T${100 + i}`, 'standing', ['AGRA_EXP_1', 'KANPUR_ORD_2', 'DELHI_AC_3'][i % 3] ?? null),
);

function dayOf(operatingDate: string, real: Readonly<Record<string, number>> = {}): OperatingDay {
  return modelOperatingDay({
    depot: DEPOT,
    buses: BUSES,
    peakRequirement: 18,
    realLengthKm: new Map(Object.entries(real)),
    operatingDate,
  });
}

describe('priceRoute', () => {
  it('prices occupied seat-kilometres and floors boardings per leg (hand worked)', () => {
    // 3 trips = 6 legs; 44 seats x 0.6 = 26.4 occupied; 26.4 / 0.45 = 58.67 -> 58 boardings a leg.
    // revenue = 6 legs x 26.4 x 100 km x Rs 1.50 = Rs 23,760; boardings = 6 x 58 = 348.
    expect(AVG_TRIP_LENGTH_SHARE).toBe(0.45);
    expect(FARE_PER_KM.express).toBe(1.5);
    expect(
      priceRoute({ serviceClass: 'express', trips: 3, seats: 44, loadFactor: 0.6, lengthKm: 100 }),
    ).toEqual({ boardings: 348, revenue: 23760 });
  });
});

describe('modelRidershipDay', () => {
  it('has one row per route of the day, with the day’s trips, length and service kilometres', () => {
    const day = dayOf('2026-10-06', { AGRA_EXP_1: 120 });
    const rows = modelRidershipDay(day);
    expect(rows.map((r) => r.routeName)).toEqual(day.routes.map((r) => r.routeName));
    for (const row of rows) {
      const route = day.routes.find((r) => r.routeName === row.routeName);
      expect([row.trips, row.lengthKm, row.serviceKm, row.serviceClass]).toEqual([
        route?.trips, route?.lengthKm, route?.serviceKm, route?.serviceClass,
      ]);
      expect(row.lengthProvenance).toBe(row.routeName === 'AGRA_EXP_1' ? 'derived' : 'modelled');
      expect(row.seatCapacity).toBe(row.trips * row.seatsPerTrip);
      expect(row.provenance).toBe('modelled');
    }
    expect(rows.reduce((total, r) => total + r.trips, 0)).toBe(18);
  });

  it('keeps the load factor near its class base, under the cap, and stable per route', () => {
    const a = modelRidershipDay(dayOf('2026-10-06'));
    const b = modelRidershipDay(dayOf('2026-10-07'));
    const band = (1 + LOAD_FACTOR_ROUTE_SPREAD) * (1 + LOAD_FACTOR_DAILY_NOISE);
    a.forEach((row, i) => {
      const base = LOAD_FACTOR_BASE[row.serviceClass];
      expect(row.loadFactor).toBeLessThanOrEqual(Math.min(MAX_LOAD_FACTOR, base * band + 0.001));
      expect(row.loadFactor).toBeGreaterThan(0);
      // The lasting route factor holds across dates; only the small daily noise moves it.
      expect(Math.abs(row.loadFactor - (b[i]?.loadFactor ?? 0))).toBeLessThan(base * 0.1);
    });
    expect(modelRidershipDay(dayOf('2026-10-06'))).toEqual(a);
  });

  it('gives earnings per km for every route that ran, real length or modelled', () => {
    const analysis = analyseRevenue(modelRidershipDay(dayOf('2026-10-06', { AGRA_EXP_1: 120 })));
    for (const route of analysis.perRoute) {
      expect(route.earningsWithheld).toBeNull();
      const perKm = route.seatsPerTrip * route.loadFactor * FARE_PER_KM[route.serviceClass];
      expect(route.earningsPerKm).toBeCloseTo(perKm, 1);
    }
    expect(analysis.depot.lengthCoverage).toEqual({ n: 1, of: 3 });
    expect(analysis.depot.modelledLengthRevenueShare).toBeGreaterThan(0);
    expect(analysis.depot.modelledLengthRevenueShare).toBeLessThan(1);
  });
});
