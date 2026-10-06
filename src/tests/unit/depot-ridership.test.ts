import { describe, it, expect } from 'vitest';
import { analyseRevenue } from '@/lib/depot/revenue/analysis';
import type { RouteRidershipDay, RouteRidershipInput } from '@/lib/depot/revenue/types';
import { modelRidershipDay } from '@/lib/depot/sim/ridership';
import {
  AVG_TRIP_LENGTH_SHARE,
  FARE_PER_KM,
  FLAT_FARE_PER_BOARDING,
  LEGS_PER_TRIP,
  MAX_LOAD_FACTOR,
} from '@/lib/depot/sim/revenueConfig';

const DATE = '2026-10-06';

function route(overrides: Partial<RouteRidershipInput> = {}): RouteRidershipInput {
  return {
    routeName: 'RKD_4560_ORD_OUT',
    serviceClass: 'ordinary',
    buses: 6,
    seatsPerBus: 52,
    scheduledDurationMin: 150,
    lengthKm: 40,
    ...overrides,
  };
}

const dayStub: RouteRidershipDay = {
  routeName: 'X',
  serviceClass: 'ordinary',
  trips: 2,
  seatsPerTrip: 50,
  seatCapacity: 100,
  loadFactor: 0.5,
  boardings: 10,
  revenue: 0,
  lengthKm: 50,
  revenueBasis: 'length_known',
  provenance: 'modelled',
};

const many: readonly RouteRidershipInput[] = Array.from({ length: 120 }, (_, i) =>
  route({
    routeName: `RKD_${4000 + i}_ORD_OUT`,
    buses: 1 + (i % 9),
    lengthKm: i % 4 === 0 ? null : 10 + i,
    serviceClass: (['ordinary', 'express', 'ac', 'premium'] as const)[i % 4] ?? 'ordinary',
  }),
);

function hasNonFinite(value: unknown): boolean {
  return /NaN|Infinity/.test(JSON.stringify(value, (_k, v: unknown) =>
    typeof v === 'number' && !Number.isFinite(v) ? 'NaN' : v,
  ));
}

describe('modelRidershipDay', () => {
  it('is deterministic and independent of input order', () => {
    const forward = modelRidershipDay(many, DATE);
    expect(modelRidershipDay([...many].reverse(), DATE)).toEqual(forward);
    expect(modelRidershipDay(many.map((r) => ({ ...r })), DATE)).toEqual(forward);
  });

  it('varies by date but a route keeps its lasting factor across dates', () => {
    const a = modelRidershipDay([route()], '2026-10-06')[0];
    const b = modelRidershipDay([route()], '2026-10-07')[0];
    expect(a?.loadFactor).not.toBe(b?.loadFactor);
    // Daily noise is small (5% of the factor), so a route's factor stays close to itself,
    // while two different routes of the same class differ by the route spread.
    const factors = (date: string): number[] =>
      modelRidershipDay(
        many.map((r) => ({ ...r, serviceClass: 'ordinary' as const })),
        date,
      ).map((d) => d.loadFactor);
    const day1 = factors('2026-10-06');
    const day2 = factors('2026-10-09');
    day1.forEach((f, i) => expect(Math.abs(f - (day2[i] ?? 0))).toBeLessThan(0.08));
    expect(Math.max(...day1) - Math.min(...day1)).toBeGreaterThan(0.1);
  });

  it('never lets the load factor or boardings exceed the maximum', () => {
    for (const day of modelRidershipDay(many, DATE)) {
      expect(day.loadFactor).toBeLessThanOrEqual(MAX_LOAD_FACTOR);
      // Boardings turn over seats: floor(seats * cap / ride share) per leg, two legs a trip.
      expect(day.boardings).toBeLessThanOrEqual(
        day.trips * LEGS_PER_TRIP * Math.floor((day.seatsPerTrip * MAX_LOAD_FACTOR) / AVG_TRIP_LENGTH_SHARE),
      );
      expect(Number.isInteger(day.boardings)).toBe(true);
      expect(Number.isInteger(day.revenue)).toBe(true);
    }
  });

  it('gives zero boardings and no division by zero for zero trips or zero seats', () => {
    const days = modelRidershipDay(
      [route({ buses: 0 }), route({ routeName: 'B', seatsPerBus: 0 })],
      DATE,
    );
    for (const day of days) {
      expect(day.boardings).toBe(0);
      expect(day.revenue).toBe(0);
    }
    const analysis = analyseRevenue(days);
    expect(analysis.depot.loadFactor).toBeNull();
    expect(hasNonFinite(analysis)).toBe(false);
  });

  it('prices a known length per occupied seat-kilometre and an unknown one at the flat fare', () => {
    const [known] = modelRidershipDay([route({ lengthKm: 40 })], DATE);
    const [unknown] = modelRidershipDay([route({ lengthKm: null })], DATE);
    expect(known?.revenueBasis).toBe('length_known');
    expect(unknown?.revenueBasis).toBe('flat_fare_unknown_length');
    const legs = (known?.trips ?? 0) * LEGS_PER_TRIP;
    const occupied = (known?.seatsPerTrip ?? 0) * (known?.loadFactor ?? 0);
    expect(known?.revenue).toBe(Math.round(legs * occupied * 40 * FARE_PER_KM.ordinary));
    expect(unknown?.revenue).toBe((unknown?.boardings ?? 0) * FLAT_FARE_PER_BOARDING);
  });

  it('survives hostile inputs with defined, finite output', () => {
    const hostile = [
      route({ buses: Number.NaN }),
      route({ routeName: 'H2', buses: Infinity, seatsPerBus: Infinity }),
      route({ routeName: 'H3', seatsPerBus: -5, lengthKm: -3 }),
      route({ routeName: 'H4', lengthKm: Number.NaN, scheduledDurationMin: Infinity }),
      route({ routeName: 'H5', lengthKm: 1e12 }),
      route({ routeName: '' }),
    ];
    const days = modelRidershipDay(hostile, DATE);
    expect(days).toHaveLength(hostile.length);
    expect(hasNonFinite(days)).toBe(false);
    expect(hasNonFinite(analyseRevenue(days))).toBe(false);
  });

  it('does not mutate its input', () => {
    const input = many.map((r) => ({ ...r }));
    const frozen = JSON.stringify(input);
    modelRidershipDay(Object.freeze(input.map((r) => Object.freeze(r))), DATE);
    expect(JSON.stringify(input)).toBe(frozen);
  });

  it('tags every row modelled', () => {
    for (const day of modelRidershipDay(many, DATE)) expect(day.provenance).toBe('modelled');
  });
});

describe('analyseRevenue', () => {
  const days = modelRidershipDay(many, DATE);
  const analysis = analyseRevenue(days);

  it('withholds earnings per kilometre for a route with no profile, with the reason', () => {
    const [day] = modelRidershipDay([route({ lengthKm: null })], DATE);
    const row = analyseRevenue(day === undefined ? [] : [day]).perRoute[0];
    expect(row?.earningsPerKm).toBeNull();
    expect(row?.earningsWithheld).toBe('unknown_length');
    expect(row?.serviceKm).toBeNull();
    expect(row?.lengthProvenance).toBeNull();
    expect(row?.revenue).toBeGreaterThan(0);
  });

  it('computes earnings per kilometre from service kilometres where length is real', () => {
    const [day] = modelRidershipDay([route({ lengthKm: 40 })], DATE);
    const row = analyseRevenue(day === undefined ? [] : [day]).perRoute[0];
    const serviceKm = (day?.trips ?? 0) * 40 * LEGS_PER_TRIP;
    expect(row?.serviceKm).toBe(serviceKm);
    expect(row?.earningsPerKm).toBe(Math.round(((day?.revenue ?? 0) / serviceKm) * 100) / 100);
    expect(row?.earningsWithheld).toBeNull();
    expect(row?.lengthProvenance).toBe('derived');
    expect(row?.provenance).toBe('modelled');
  });

  it('reconciles: routes sum to the depot total in whole boardings and rupees', () => {
    expect(analysis.depot.boardings).toBe(analysis.perRoute.reduce((s, r) => s + r.boardings, 0));
    expect(analysis.depot.revenue).toBe(analysis.perRoute.reduce((s, r) => s + r.revenue, 0));
    expect(Number.isInteger(analysis.depot.revenue)).toBe(true);
    expect(analysis.depot.routes).toBe(many.length);
  });

  it('states coverage of earnings per kilometre as N of M routes', () => {
    const known = many.filter((r) => r.lengthKm !== null).length;
    expect(analysis.depot.earningsCoverage).toEqual({ n: known, of: many.length });
    expect(analysis.depot.provenance).toBe('modelled');
  });

  it('uses the ratio of sums for load factor, weighted by seats offered, not the mean of ratios', () => {
    const small = route({ routeName: 'S', buses: 1, seatsPerBus: 10 });
    const big = route({ routeName: 'L', buses: 40, seatsPerBus: 52 });
    const rows = modelRidershipDay([small, big], DATE);
    const result = analyseRevenue(rows);
    const occupied = rows.reduce((s, r) => s + r.seatCapacity * r.loadFactor, 0);
    const capacity = rows.reduce((s, r) => s + r.seatCapacity, 0);
    const meanOfRatios = rows.reduce((s, r) => s + r.loadFactor, 0) / rows.length;
    expect(result.depot.loadFactor).toBeCloseTo(occupied / capacity, 10);
    expect(Math.abs((result.depot.loadFactor ?? 0) - meanOfRatios)).toBeGreaterThan(0.005);
    expect(result.depot.loadFactor ?? 2).toBeLessThanOrEqual(MAX_LOAD_FACTOR);
  });

  it('weights the depot load factor by trips, with worked figures stated as literals', () => {
    // Route A offers 100 seats and fills half of them; route B offers 300 and fills 90%.
    // Occupied: 50 + 270 = 320 of 400 offered, so 0.80. The plain mean of 0.5 and 0.9 is 0.70.
    const a: RouteRidershipDay = { ...dayStub, routeName: 'A', seatCapacity: 100, loadFactor: 0.5 };
    const b: RouteRidershipDay = { ...dayStub, routeName: 'B', seatCapacity: 300, loadFactor: 0.9 };
    expect(analyseRevenue([a, b]).depot.loadFactor).toBeCloseTo(0.8, 10);
    expect(analyseRevenue([b, a]).depot.loadFactor).toBeCloseTo(0.8, 10);
  });

  it('says how much of the revenue and of the routes rest on the flat fare', () => {
    const days: RouteRidershipDay[] = [
      { ...dayStub, routeName: 'A', revenue: 600, revenueBasis: 'length_known' },
      { ...dayStub, routeName: 'B', revenue: 200, revenueBasis: 'flat_fare_unknown_length' },
      { ...dayStub, routeName: 'C', revenue: 200, revenueBasis: 'flat_fare_unknown_length', lengthKm: null },
      { ...dayStub, routeName: 'D', revenue: 0, revenueBasis: 'length_known' },
    ];
    const { depot } = analyseRevenue(days);
    expect(depot.revenue).toBe(1000);
    expect(depot.flatFareRevenueShare).toBe(0.4);
    expect(depot.flatFareRouteShare).toBe(0.5);
    const none = analyseRevenue([]).depot;
    expect(none.flatFareRevenueShare).toBeNull();
    expect(none.flatFareRouteShare).toBeNull();
  });

  it('computes depot earnings per kilometre over known-length routes only', () => {
    const known = analysis.perRoute.filter((r) => r.serviceKm !== null);
    const revenue = known.reduce((s, r) => s + r.revenue, 0);
    const km = known.reduce((s, r) => s + (r.serviceKm ?? 0), 0);
    expect(analysis.depot.earningsPerKm).toBe(Math.round((revenue / km) * 100) / 100);
  });

  it('gives no depot earnings per kilometre when no route has a known length', () => {
    const rows = modelRidershipDay(many.map((r) => ({ ...r, lengthKm: null })), DATE);
    const result = analyseRevenue(rows);
    expect(result.depot.earningsPerKm).toBeNull();
    expect(result.depot.earningsCoverage).toEqual({ n: 0, of: many.length });
  });

  it('is independent of input order and does not mutate its input', () => {
    const copy = days.map((d) => ({ ...d }));
    expect(analyseRevenue([...copy].reverse())).toEqual(analysis);
    expect(copy).toEqual(days);
  });
});
