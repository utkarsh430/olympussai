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
    for (const journeyMinutes of [null, 45, 120, 300, 493]) {
      const day = modelledRouteHours(fleet({ journeyMinutes }));
      expect(day.every((h) => h.deployed >= 0 && h.deployed <= FLEET)).toBe(true);
    }
  });

  it('reaches near the whole fleet at its peak, for an unknown and for a long journey', () => {
    expect(peakOf(fleet())).toBeGreaterThanOrEqual(0.6 * FLEET);
    expect(peakOf(fleet({ journeyMinutes: 493 }))).toBeGreaterThanOrEqual(0.6 * FLEET);
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
    // One bus, out and back plus a layover: 150 minutes in all, spread over the hours it covers.
    expect(one.reduce((s, h) => s + h.deployed, 0)).toBeCloseTo(2.5, 1);
    expect(one.every((h) => Math.round(h.deployed * 10) === h.deployed * 10)).toBe(true);
  });

  it('runs nothing without a whole bus, or for a bus count the trip model refuses', () => {
    for (const buses of [0, 0.5, -3, Number.NaN, 501]) {
      expect(modelledRouteHours(fleet({ buses })).every((h) => h.deployed === 0)).toBe(true);
    }
  });
});
