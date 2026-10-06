import { describe, expect, it } from 'vitest';
import type { DepotBusView } from '@/lib/depot/api';
import { analyseFuel } from '@/lib/depot/fuel/analysis';
import { analyseRevenue } from '@/lib/depot/revenue/analysis';
import { crewShiftsFor } from '@/lib/depot/crew/roster';
import { modelFuelDay } from '@/lib/depot/sim/fuel';
import { FUEL_CLASS_KM_PER_LITRE } from '@/lib/depot/sim/fuelConfig';
import { modelOperatingDay } from '@/lib/depot/sim/operatingDay';
import type { OperatingDay } from '@/lib/depot/sim/operatingDayTypes';
import { FARE_PER_KM } from '@/lib/depot/sim/revenueConfig';
import { modelRidershipDay } from '@/lib/depot/sim/ridership';
import type { BusOpState, DepotSummary } from '@/lib/depot/types';

/*
 * The reconciliations of ruling S41: for one depot and operating date every
 * modelled domain reads the same day, so the pages agree with each other.
 */

const DEPOT = { id: '7', name: 'Kaushambi', kind: 'depot', fleet: 0 } as unknown as DepotSummary;
const STATES: readonly BusOpState[] = ['in_service', 'on_road', 'standing', 'dark', 'off_road'];
const ROUTES: readonly (string | null)[] = ['A_EXP_1', 'B_ORD_2', 'C_AC_3', 'D_VOLVO_4', 'E_5', null];

function bus(registrationNumber: string, state: BusOpState, routeName: string | null): DepotBusView {
  return { registrationNumber, state, routeName } as unknown as DepotBusView;
}

/** Depot `n`: its size, states, routes, requirement and date all vary deterministically. */
function dayOf(n: number): OperatingDay {
  const buses = Array.from({ length: (n * 7) % 60 }, (_, i) =>
    bus(`UP${n}Z${i}`, STATES[(i * 3 + n) % 5] as BusOpState, ROUTES[(i + n) % (2 + (n % 5))] ?? null),
  );
  return modelOperatingDay({
    depot: { ...DEPOT, id: `d${n}` },
    buses,
    peakRequirement: (n * 11) % 45,
    realLengthKm: new Map([['A_EXP_1', 61.37], ['C_AC_3', 143.249]]),
    operatingDate: `2026-10-${String(1 + (n % 28)).padStart(2, '0')}`,
  });
}

const DAYS = Array.from({ length: 150 }, (_, n) => dayOf(n));
const tenths = (km: number): number => Math.round(km * 10);
const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

describe('one modelled day reconciles across crew, fuel and revenue', () => {
  it('duties = trips + duties without a bus = buses that ran + duties without a bus', () => {
    for (const day of DAYS) {
      const revenue = analyseRevenue(modelRidershipDay(day));
      const fuel = analyseFuel(modelFuelDay(day));
      expect(revenue.depot.trips + day.dutiesWithoutBus).toBe(day.duties.length);
      expect(fuel.depot.busCount + day.dutiesWithoutBus).toBe(day.duties.length);
      expect(fuel.perBus.every((b) => b.distanceKm > 0)).toBe(true);
      expect(revenue.depot.routes).toBe(new Set(day.duties.map((d) => d.routeName)).size);
      for (const route of revenue.perRoute) {
        const ran = day.runs.filter((r) => r.routeName === route.routeName).length;
        expect(route.trips).toBe(ran);
      }
    }
  });

  it('crew shifts are the duties plus the relief splits', () => {
    for (const day of DAYS) {
      const crew = crewShiftsFor(day.duties);
      expect(crew.shifts.length).toBeGreaterThanOrEqual(day.duties.length);
      // A duty split into k shifts adds k - 1 relief splits.
      const splits = sum(crew.shifts.filter((s) => s.shiftIndex === 0).map((s) => s.shiftCount - 1));
      expect(crew.shifts.length - day.duties.length).toBe(splits);
      expect(splits).toBeGreaterThanOrEqual(crew.dutiesNeedingRelief);
      expect(new Set(crew.shifts.map((s) => s.dutyId))).toEqual(new Set(day.duties.map((d) => d.id)));
    }
  });

  it('the fuel distance is the revenue service distance, to the tenth of a kilometre', () => {
    let checked = 0;
    for (const day of DAYS) {
      const fuel = analyseFuel(modelFuelDay(day));
      const revenue = analyseRevenue(modelRidershipDay(day));
      const perBus = sum(fuel.perBus.map((b) => tenths(b.distanceKm)));
      expect(perBus).toBe(sum(revenue.perRoute.map((r) => tenths(r.serviceKm))));
      expect(tenths(fuel.depot.distanceKm)).toBe(perBus);
      // Route by route as well: the fuel page's route rows are the revenue page's routes.
      for (const route of revenue.perRoute) {
        const row = fuel.perRoute.find((r) => r.key === route.routeName);
        expect(tenths(row?.distanceKm ?? 0)).toBe(tenths(route.serviceKm));
        expect(row?.busCount ?? 0).toBe(route.trips);
      }
      checked += perBus;
    }
    expect(checked).toBeGreaterThan(100000);
  });

  it('a depot with no duties is empty in every domain', () => {
    const none = modelOperatingDay({
      depot: DEPOT,
      buses: [bus('X1', 'standing', null), bus('X2', 'on_road', null)],
      peakRequirement: 2,
      realLengthKm: new Map(),
      operatingDate: '2026-10-06',
    });
    expect(none.duties).toEqual([]);
    expect(crewShiftsFor(none.duties).shifts).toEqual([]);
    expect(modelFuelDay(none)).toEqual([]);
    const fuel = analyseFuel(modelFuelDay(none));
    expect([fuel.depot.distanceKm, fuel.depot.fuelLitres, fuel.depot.costPerKm]).toEqual([0, 0, null]);
    const revenue = analyseRevenue(modelRidershipDay(none));
    expect(revenue.perRoute).toEqual([]);
    expect([revenue.depot.trips, revenue.depot.revenue, revenue.depot.earningsPerKm]).toEqual([0, 0, null]);
  });
});

describe('the worked depot, every page side by side', () => {
  /*
   * Four express buses, all available; two routes of real length; requirement 3.
   *   duties: AGRA_EXP_1, DELHI_EXP_2, AGRA_EXP_1 (round-robin by name) = 3 duties, 2 routes
   *   buses:  4 available, the first 3 of the day's order ran, 1 did not
   *   AGRA_EXP_1  120 km one way -> 240.0 km a trip, 2 trips = 480.0 km
   *   DELHI_EXP_2  95.5 km       -> 191.0 km a trip, 1 trip  = 191.0 km
   *   day: 671.0 km on both the fuel page and the revenue page
   * Every bus is express (44 seats, Rs 1.50 a seat-kilometre). On a route with
   * load factor f and length L a trip earns 2 x 44 x f x L x 1.50 rupees.
   */
  const worked = modelOperatingDay({
    depot: DEPOT,
    buses: ['K1', 'K2', 'K3', 'K4'].map((r, i) =>
      bus(r, 'standing', i % 2 === 0 ? 'AGRA_EXP_1' : 'DELHI_EXP_2'),
    ),
    peakRequirement: 3,
    realLengthKm: new Map([['AGRA_EXP_1', 120], ['DELHI_EXP_2', 95.5]]),
    operatingDate: '2026-10-06',
  });
  const fuel = analyseFuel(modelFuelDay(worked));
  const revenue = analyseRevenue(modelRidershipDay(worked));

  it('shows 3 duties, 3 trips, 3 of 4 buses, 671.0 km on every page', () => {
    expect(worked.duties).toHaveLength(3);
    expect(crewShiftsFor(worked.duties).shifts.length).toBeGreaterThanOrEqual(3);
    expect(fuel.depot.busCount).toBe(3);
    expect(worked.notRun).toHaveLength(1);
    expect(fuel.depot.distanceKm).toBe(671);
    expect(revenue.depot.trips).toBe(3);
    expect(revenue.depot.routes).toBe(2);
    expect(revenue.perRoute.map((r) => [r.routeName, r.trips, r.serviceKm, r.lengthProvenance])).toEqual([
      ['AGRA_EXP_1', 2, 480, 'derived'],
      ['DELHI_EXP_2', 1, 191, 'derived'],
    ]);
  });

  it('prices each route by its length and gives earnings per km for every route', () => {
    for (const route of revenue.perRoute) {
      expect(route.seatsPerTrip).toBe(44);
      const perKm = 44 * route.loadFactor * FARE_PER_KM.express;
      expect(route.revenue).toBe(Math.round(route.trips * 2 * route.lengthKm * perKm));
      expect(route.earningsPerKm).toBeCloseTo(perKm, 1);
      expect(route.earningsWithheld).toBeNull();
    }
    expect(revenue.depot.lengthCoverage).toEqual({ n: 2, of: 2 });
  });

  it('issues fuel as distance over each bus’s modelled efficiency', () => {
    for (const row of fuel.perBus) {
      expect(row.serviceClass).toBe('express');
      // Class figure 4.6 km/L, within the 12% lasting and 3% daily spread.
      expect(row.kmPerLitre ?? 0).toBeGreaterThan(FUEL_CLASS_KM_PER_LITRE.express * 0.85);
      expect(row.kmPerLitre ?? 0).toBeLessThan(FUEL_CLASS_KM_PER_LITRE.express * 1.16);
      expect(row.fuelLitres).toBeCloseTo(row.distanceKm / (row.kmPerLitre ?? 1), 1);
    }
  });
});
