// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { modelledRouteHours, type RouteFleetInput } from '@/lib/depot/service/modelledDeployment';

const DATE = '2026-10-06';
const FLEET = 21;

function fleet(over: Partial<RouteFleetInput> = {}): RouteFleetInput {
  return { routeName: 'VND_1613_ORD_OUT', operatingDate: DATE, buses: FLEET, journeyMinutes: null, ...over };
}

const peakOf = (input: RouteFleetInput): number =>
  Math.max(...modelledRouteHours(input).map((h) => h.deployed));

describe('modelledRouteHours: the route own buses, each on a modelled duty', () => {
  const hours = modelledRouteHours(fleet());

  it('answers 24 hours of the route', () => {
    expect(hours.map((h) => h.hour)).toEqual(Array.from({ length: 24 }, (_, i) => i));
    expect(hours.every((h) => h.routeName === 'VND_1613_ORD_OUT' && h.operatingDate === DATE)).toBe(true);
  });

  it('never runs more buses than the route has, nor fewer than none', () => {
    for (const journeyMinutes of [null, 30, 45, 120, 300, 493, 1200]) {
      const day = modelledRouteHours(fleet({ journeyMinutes }));
      expect(day.every((h) => h.deployed >= 0 && h.deployed <= FLEET)).toBe(true);
    }
  });

  it('reaches near the whole fleet at its peak, for an unknown and for a long journey', () => {
    expect(peakOf(fleet())).toBeGreaterThanOrEqual(0.75 * FLEET);
    expect(peakOf(fleet({ journeyMinutes: 493 }))).toBeGreaterThanOrEqual(0.75 * FLEET);
  });

  it('works each bus a day on a short route: a 30-minute route with 20 buses peaks at 80% or more', () => {
    const short = fleet({ routeName: 'SLP_198_ORD_OUT', buses: 20, journeyMinutes: 30 });
    expect(peakOf(short)).toBeGreaterThanOrEqual(0.8 * 20);
    // Seeded starts vary by date (a third of buses start through the day, not in the
    // morning), so across a fortnight the peak averages near four fifths of the fleet, where
    // one round trip a bus gave about half.
    const dates = Array.from({ length: 14 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
    const shares = dates.map((operatingDate) => peakOf({ ...short, operatingDate }) / 20);
    expect(shares.reduce((s, x) => s + x, 0) / shares.length).toBeGreaterThanOrEqual(0.75);
  });

  it('runs a long route bus for at least one journey and its layover', () => {
    // 493 + 15 minutes is longer than the shortest drawn day (6 hours), so every duty runs
    // at least that long unless the day ends first.
    const one = modelledRouteHours(fleet({ buses: 1, journeyMinutes: 493 }));
    const hours = one.reduce((s, h) => s + h.deployed, 0);
    const lastHour = Math.max(...one.filter((h) => h.deployed > 0).map((h) => h.hour));
    expect(hours >= 508 / 60 - 0.2 || lastHour === 23).toBe(true);
  });

  it('runs little at night: no duty starts before 04:00', () => {
    for (const hour of [0, 1, 2, 3]) {
      expect(hours[hour]?.deployed).toBe(0);
    }
  });

  it('is seeded by route and date: the same inputs give the same day, another date differs', () => {
    expect(modelledRouteHours(fleet())).toEqual(hours);
    const other = modelledRouteHours(fleet({ operatingDate: '2026-10-07' }));
    expect(other.map((h) => h.deployed)).not.toEqual(hours.map((h) => h.deployed));
    const route = modelledRouteHours(fleet({ routeName: 'AKP_1577_ORD_OUT' }));
    expect(route.map((h) => h.deployed)).not.toEqual(hours.map((h) => h.deployed));
  });

  it('counts the bus-hours of each duty in each hour it covers, one decimal', () => {
    const one = modelledRouteHours(fleet({ buses: 1, journeyMinutes: 60 }));
    // One bus works a drawn day of 6 to 10 hours (longer than its journey and layover),
    // clipped at the end of the day.
    const total = one.reduce((s, h) => s + h.deployed, 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(10.05);
    expect(one.every((h) => Math.round(h.deployed * 10) === h.deployed * 10)).toBe(true);
  });

  it('draws a working day of 6 to 10 hours on a short route, unless the day ends first', () => {
    for (const date of ['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10']) {
      const one = modelledRouteHours(fleet({ operatingDate: date, buses: 1, journeyMinutes: 30 }));
      const total = one.reduce((s, h) => s + h.deployed, 0);
      const endsAtMidnight = (one[23]?.deployed ?? 0) === 1;
      expect(total).toBeLessThanOrEqual(10.05);
      if (!endsAtMidnight) expect(total).toBeGreaterThanOrEqual(5.95);
    }
  });

  it('runs nothing without a whole bus, or for a bus count the trip model refuses', () => {
    for (const buses of [0, 0.5, -3, Number.NaN, 501]) {
      expect(modelledRouteHours(fleet({ buses })).every((h) => h.deployed === 0)).toBe(true);
    }
  });
});
