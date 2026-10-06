import { describe, it, expect } from 'vitest';
import { analyseRevenue } from '@/lib/depot/revenue/analysis';
import { FUEL_CLASS_KM_PER_LITRE } from '@/lib/depot/sim/fuelConfig';
import { DEFAULT_PRICE_PER_LITRE } from '@/lib/depot/fuel/types';
import { SEATS_BY_CLASS } from '@/lib/depot/sim/config';
import { LOAD_FACTOR_BASE, FARE_PER_KM } from '@/lib/depot/sim/revenueConfig';
import { priceRoute } from '@/lib/depot/sim/ridershipFigures';
import { modelRouteLength } from '@/lib/depot/sim/operatingDay';
import type { RouteLengthProvenance } from '@/lib/depot/sim/operatingDayTypes';
import { modelTripsPerDay } from '@/lib/depot/sim/tripFrequency';
import type { RouteRidershipDay } from '@/lib/depot/revenue/types';
import type { ServiceClass } from '@/lib/depot/sim/types';

const CLASSES: readonly ServiceClass[] = ['ordinary', 'express', 'ac', 'premium'];

function dayOf(
  serviceClass: ServiceClass,
  trips: number,
  seats: number,
  loadFactor: number,
  lengthKm: number,
  lengthProvenance: RouteLengthProvenance = 'derived',
): RouteRidershipDay {
  const priced = priceRoute({ serviceClass, trips, seats, loadFactor, lengthKm });
  return {
    routeName: 'R',
    serviceClass,
    trips,
    seatsPerTrip: seats,
    seatCapacity: trips * seats,
    loadFactor,
    ...priced,
    lengthKm,
    lengthProvenance,
    // The operating day's service km: every trip runs the route out and back.
    serviceKm: trips * lengthKm * 2,
    provenance: 'modelled',
  };
}

describe('scale of revenue, worked by hand', () => {
  it('uses the trip count the frequency model gives for 4 buses and 120 minutes', () => {
    // 4 buses run the route; at a scheduled 120 minutes the model gives 2 trips per bus.
    expect(
      modelTripsPerDay({ routeName: 'HAND_ORD', buses: 4, scheduledDurationMin: 120 }, '2026-10-06')
        .tripsPerDay,
    ).toBe(8);
  });

  it('ordinary, 8 trips, 50 seats, load factor 0.6, 100 km, fare 1.1 a km', () => {
    // 8 trips are 16 legs. Per leg: boardings floor(50 * 0.6 / 0.45) = floor(66.67) = 66;
    // revenue 50 * 0.6 * 100 km * 1.1 = 3,300. Day: 16 * 66 = 1,056 boardings; 16 * 3,300 = 52,800.
    // Service km 8 * 100 * 2 = 1,600; earnings per km 52,800 / 1,600 = 33.00 (= 50 * 0.6 * 1.1).
    const day = dayOf('ordinary', 8, 50, 0.6, 100);
    expect(day.boardings).toBe(1056);
    expect(day.revenue).toBe(52800);
    const row = analyseRevenue([day]).perRoute[0];
    expect(row?.serviceKm).toBe(1600);
    expect(row?.earningsPerKm).toBe(33);
  });

  it('express, 5 trips, 44 seats, load factor 0.5, 60 km, fare 1.5 a km', () => {
    // 10 legs. Per leg: boardings floor(44 * 0.5 / 0.45) = floor(48.89) = 48; revenue
    // 44 * 0.5 * 60 * 1.5 = 1,980. Day: 480 boardings, 19,800 rupees. Service km 600;
    // earnings per km 19,800 / 600 = 33.00.
    const day = dayOf('express', 5, 44, 0.5, 60);
    expect(day.boardings).toBe(480);
    expect(day.revenue).toBe(19800);
    expect(analyseRevenue([day]).perRoute[0]?.earningsPerKm).toBe(33);
  });

  it('a route with no real profile is priced on its modelled length, earnings still given', () => {
    // There is no flat fare and no withholding: a route without a real profile
    // runs on the MODELLED typical length of its class; earnings per km do not depend on it.
    const length = modelRouteLength('HAND_UNKNOWN', 'ordinary', null);
    expect(length.lengthProvenance).toBe('modelled');
    expect(length.lengthKm).toBeGreaterThanOrEqual(70);
    expect(length.lengthKm).toBeLessThanOrEqual(160);
    // 4 trips are 8 legs; per leg floor(52 * 0.62 / 0.45) = floor(71.64) = 71; day 568
    // boardings. Revenue per leg 52 * 0.62 * L * 1.1 = 35.464 L; day 8 * 35.464 L = 283.712 L.
    const day = dayOf('ordinary', 4, 52, 0.62, length.lengthKm, 'modelled');
    expect(day.boardings).toBe(568);
    expect(day.revenue).toBe(Math.round(283.712 * length.lengthKm));
    const row = analyseRevenue([day]).perRoute[0];
    // Service km 4 * 2 * L = 8 L; earnings 283.712 L / 8 L = 35.464, to two decimals 35.46.
    expect(row?.earningsPerKm).toBe(35.46);
    expect(row?.earningsWithheld).toBeNull();
    expect(row?.lengthProvenance).toBe('modelled');
  });

  it('a modelled length of 100 km gives the literal figures, and is counted, not hidden', () => {
    // Revenue 283.712 * 100 = 28,371.2 -> 28,371 rupees; service km 4 * 2 * 100 = 800;
    // earnings 28,371 / 800 = 35.46375 -> 35.46.
    const day = dayOf('ordinary', 4, 52, 0.62, 100, 'modelled');
    expect(day.revenue).toBe(28371);
    const analysis = analyseRevenue([day]);
    expect(analysis.perRoute[0]?.earningsPerKm).toBe(35.46);
    expect(analysis.depot.lengthCoverage).toEqual({ n: 0, of: 1 });
    expect(analysis.depot.modelledLengthRevenueShare).toBe(1);
    expect(analysis.depot.earningsPerKm).toBe(35.46);
  });

  it('earnings per kilometre do not depend on the route length', () => {
    const short = analyseRevenue([dayOf('ac', 6, 40, 0.45, 20)]).perRoute[0]?.earningsPerKm;
    const long = analyseRevenue([dayOf('ac', 6, 40, 0.45, 400)]).perRoute[0]?.earningsPerKm;
    // 40 * 0.45 * 2.2 = 39.60
    expect(short).toBe(39.6);
    expect(long).toBe(39.6);
  });
});

describe('sanity: earnings beat fuel cost per kilometre at the base load factor', () => {
  it.each(CLASSES)('%s', (serviceClass) => {
    const seats = SEATS_BY_CLASS[serviceClass];
    const earnings = seats * LOAD_FACTOR_BASE[serviceClass] * FARE_PER_KM[serviceClass];
    const fuelCost = DEFAULT_PRICE_PER_LITRE / FUEL_CLASS_KM_PER_LITRE[serviceClass];
    expect(earnings).toBeGreaterThan(fuelCost);
    const row = analyseRevenue([
      dayOf(serviceClass, 6, seats, LOAD_FACTOR_BASE[serviceClass], 80),
    ]).perRoute[0];
    expect(row?.earningsPerKm ?? 0).toBeGreaterThan(fuelCost);
  });
});
