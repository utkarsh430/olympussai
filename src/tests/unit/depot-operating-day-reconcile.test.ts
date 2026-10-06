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
  // Heard a minute ago, in the yard: a standing bus is then eligible for a duty (ruling S47).
  return {
    registrationNumber, state, routeName, location: 'in_yard', gpsAgeMin: 1, notHeardMin: null,
  } as unknown as DepotBusView;
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

  it('pins every page’s figures for the worked depot as literals', () => {
    // WHO RUNS. Duties 000 and 002 on AGRA_EXP_1, 001 on DELHI_EXP_2. Each bus takes a duty
    // of the route it reports live (ruling S47): K2 DELHI, K1 and K3 AGRA; K4 (DELHI) has none.
    expect(worked.runs.map((r) => [r.registrationNumber, r.routeName, r.distanceKm])).toEqual([
      ['K2', 'DELHI_EXP_2', 191],
      ['K1', 'AGRA_EXP_1', 240],
      ['K3', 'AGRA_EXP_1', 240],
    ]);
    expect(worked.notRun).toEqual([{ registrationNumber: 'K4', reason: 'no_duty' }]);

    // CREW. Each of the 3 duties is short enough for one shift, so 3 shifts and no relief.
    const crew = crewShiftsFor(worked.duties);
    expect(crew.shifts).toHaveLength(3);
    expect(crew.dutiesNeedingRelief).toBe(0);

    // FUEL at Rs 92 a litre. Each bus's economy is seeded (K1 4.97, K2 4.04, K3 4.64 km/L);
    // litres are distance over economy to the tenth, rupees are litres x 92 rounded:
    //   K1 240 km -> 48.3 L -> 48.3 x 92 = 4,443.6 -> 4,444
    //   K2 191 km -> 47.3 L -> 47.3 x 92 = 4,351.6 -> 4,352
    //   K3 240 km -> 51.7 L -> 51.7 x 92 = 4,756.4 -> 4,756
    //   depot 671 km, 147.3 L, Rs 13,552; cost per km 13,552 / 671 = 20.197
    expect(fuel.perBus.map((b) => [b.registrationNumber, b.fuelLitres, b.cost])).toEqual([
      ['K1', 48.3, 4444],
      ['K2', 47.3, 4352],
      ['K3', 51.7, 4756],
    ]);
    expect(fuel.depot).toMatchObject({ distanceKm: 671, fuelLitres: 147.3, cost: 13552, busCount: 3 });
    expect(fuel.depot.costPerKm).toBeCloseTo(20.197, 3);

    // REVENUE. Express: 44 seats, Rs 1.50 a seat-km, a boarding rides 45% of the route.
    // Load factors are seeded per route and date: AGRA 0.544, DELHI 0.437.
    //   AGRA  2 trips = 4 legs; occupied 44 x 0.544 = 23.936; boardings floor(23.936 / 0.45)
    //         = 53 a leg -> 212; revenue 23.936 x 120 x 1.5 = 4,308.48 a leg -> 17,233.92
    //         -> 17,234; earnings 17,234 / 480 = 35.904 -> 35.90 a km
    //   DELHI 1 trip = 2 legs; occupied 44 x 0.437 = 19.228; boardings floor(42.73) = 42 a leg
    //         -> 84; revenue 19.228 x 95.5 x 1.5 = 2,754.41 a leg -> 5,508.82 -> 5,509;
    //         earnings 5,509 / 191 = 28.843 -> 28.84 a km
    //   depot 296 boardings, Rs 22,743 over 671 km = 33.894 -> 33.89 a km; load factor
    //         (88 x 0.544 + 44 x 0.437) / 132 = 67.1 / 132 = 0.5083
    expect(
      revenue.perRoute.map((r) => [r.routeName, r.loadFactor, r.boardings, r.revenue, r.earningsPerKm]),
    ).toEqual([
      ['AGRA_EXP_1', 0.544, 212, 17234, 35.9],
      ['DELHI_EXP_2', 0.437, 84, 5509, 28.84],
    ]);
    expect(revenue.depot).toMatchObject({
      boardings: 296,
      revenue: 22743,
      serviceKm: 671,
      earningsPerKm: 33.89,
      modelledLengthRevenueShare: 0,
      lengthCoverage: { n: 2, of: 2 },
    });
    expect(revenue.depot.loadFactor).toBeCloseTo(67.1 / 132, 10);

    // ECONOMICS reads exactly these: earnings 33.89, fuel cost 20.197, load factor 0.5083 and
    // 2 of 2 routes on a real length (the inputs economicsView builds from the same day).
    const input = {
      earningsPerKm: revenue.depot.earningsPerKm,
      costPerKm: fuel.depot.costPerKm,
      loadFactor: revenue.depot.loadFactor,
      lengthCoverage: revenue.depot.lengthCoverage,
    };
    expect(input.earningsPerKm).toBe(33.89);
    expect(input.costPerKm).toBeCloseTo(13552 / 671, 10);
    expect(input.loadFactor).toBeCloseTo(0.5083, 4);
    expect(input.lengthCoverage).toEqual({ n: 2, of: 2 });
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
