import { describe, expect, it } from 'vitest';
import type { DepotBusView } from '@/lib/depot/api';
import type { EconomicsDepotRow } from '@/lib/depot/revenue/api';
import { analyseRevenue } from '@/lib/depot/revenue/analysis';
import { lengthCoverageLine } from '@/lib/depot/revenue/economicsStatement';
import { modelOperatingDay } from '@/lib/depot/sim/operatingDay';
import { modelRidershipDay } from '@/lib/depot/sim/ridership';
import type { DepotSummary } from '@/lib/depot/types';

/*
 * The sentence about route lengths must say what the model does.
 * Change one route's length and watch: the route's own earnings per km stay,
 * the depot's (a distance-weighted mean over its routes) moves.
 */

const DEPOT = { id: '7', name: 'Kaushambi', kind: 'depot', fleet: 4 } as unknown as DepotSummary;
const BUSES = ['K1', 'K2', 'K3', 'K4'].map(
  (registrationNumber, i) =>
    ({
      registrationNumber, state: 'standing', location: 'in_yard', gpsAgeMin: 1, notHeardMin: null,
      routeName: i % 2 === 0 ? 'AGRA_EXP_1' : 'DELHI_EXP_2',
    }) as unknown as DepotBusView,
);

function revenueWith(agraKm: number) {
  const day = modelOperatingDay({
    depot: DEPOT,
    buses: BUSES,
    peakRequirement: 3,
    realLengthKm: new Map([['AGRA_EXP_1', agraKm], ['DELHI_EXP_2', 95.5]]),
    operatingDate: '2026-10-06',
  });
  return analyseRevenue(modelRidershipDay(day));
}

const ROW = { kind: 'depot', lengthCoverage: { n: 1, of: 2 } } as unknown as EconomicsDepotRow;

describe('the route-length sentence matches the model', () => {
  it('a length leaves a route’s earnings per km alone and moves the depot’s', () => {
    const short = revenueWith(120);
    const long = revenueWith(400);
    const perRoute = (r: typeof short): (number | null)[] =>
      r.perRoute.map((route) => route.earningsPerKm);
    for (const [i, value] of perRoute(short).entries()) {
      expect(perRoute(long)[i]).toBeCloseTo(value ?? 0, 1);
    }
    expect(long.depot.earningsPerKm).not.toBeCloseTo(short.depot.earningsPerKm ?? 0, 1);

    const line = lengthCoverageLine([ROW]) ?? '';
    expect(line).toContain('Earnings per kilometre on a route do not depend on its length');
    expect(line).toContain("a real length can move a depot's figures and its rank");
    expect(line).not.toMatch(/not the ranking/);
  });
});
