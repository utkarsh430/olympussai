import { describe, expect, it } from 'vitest';
import { planAllocation, runAllocation } from '@/lib/depot/optimise/allocate';
import { MAX_BUSES, MAX_TRIPS_PER_DAY } from '@/lib/depot/optimise/allocateConfig';
import { dailyCost } from '@/lib/depot/optimise/allocateSearch';
import type { AllocDepot, AllocRoute, AllocationPlan } from '@/lib/depot/optimise/allocateTypes';

function route(
  routeName: string,
  currentDepotId: string,
  busesNeeded: number,
  tripsPerDay: number,
  deadKmByDepot: Record<string, number>,
): AllocRoute {
  return { routeName, currentDepotId, busesNeeded, tripsPerDay, deadKmByDepot };
}

const depot = (depotId: string, capacity: number): AllocDepot => ({ depotId, capacity });

/** The grid arithmetic before the early per-trip rounding was introduced. */
const onGrid = (km: number, trips: number): number => Math.round(km * 10) * 100 * trips;

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('dailyCost without early rounding', () => {
  it('reports the true saving where the kilometre figures are off the one-decimal grid', () => {
    // True 4.62 km a day: below the threshold, so the route stays. Early rounding said 6.3.
    const below = planAllocation(
      [route('r', 'A', 1, 21, { A: 10.06, B: 9.84 })],
      [depot('A', 5), depot('B', 5)],
    );
    expect(below.moves).toEqual([]);
    expect(below.unchanged).toEqual([{ routeName: 'r', reason: 'below_threshold' }]);
    // True 5.25 km a day: worth moving. Early rounding said 4.2.
    const above = planAllocation(
      [route('r', 'A', 1, 21, { A: 10.04, B: 9.79 })],
      [depot('A', 5), depot('B', 5)],
    );
    expect(above.moves).toHaveLength(1);
    expect(above.savedKmPerDay).toBe(5.2);
  });

  it('is identical to the one-decimal behaviour for whole trips and one-decimal kilometres', () => {
    const rand = seeded(20261006);
    for (let i = 0; i < 2000; i += 1) {
      const km = Math.round(rand() * 8000) / 10;
      const trips = Math.floor(rand() * 60);
      const cost = dailyCost(km, trips);
      expect(cost).toBe(onGrid(km, trips));
      expect(Number.isInteger(cost)).toBe(true);
    }
  });
});

describe('uncostable counts above the bound', () => {
  const finite = (plan: AllocationPlan): boolean =>
    [plan.beforeKmPerDay, plan.afterKmPerDay, plan.savedKmPerDay].every(Number.isFinite);

  it('treats huge trips like fractional trips: no_candidate, left out of the totals', () => {
    const depots = [depot('A', 5), depot('B', 5)];
    for (const trips of [1e306, MAX_TRIPS_PER_DAY + 1]) {
      const plan = planAllocation(
        [route('big', 'A', 1, trips, { A: 20, B: 1 }), route('ok', 'A', 1, 2, { A: 5, B: 5 })],
        depots,
      );
      expect(plan.unchanged.find((u) => u.routeName === 'big')?.reason).toBe('no_candidate');
      expect(finite(plan)).toBe(true);
      expect(plan.beforeKmPerDay).toBe(10);
    }
  });

  it('treats huge bus counts the same way, and accepts the bound itself', () => {
    const depots = [depot('A', MAX_BUSES), depot('B', MAX_BUSES)];
    const plan = planAllocation([route('big', 'A', 1e306, 2, { A: 20, B: 1 })], depots);
    expect(plan.unchanged).toEqual([{ routeName: 'big', reason: 'no_candidate' }]);
    expect(finite(plan)).toBe(true);
    const edge = planAllocation([route('edge', 'A', 1, MAX_TRIPS_PER_DAY, { A: 20, B: 1 })], depots);
    expect(edge.moves).toHaveLength(1);
    const edgeBuses = planAllocation([route('edge', 'A', MAX_BUSES, 2, { A: 20, B: 1 })], depots);
    expect(edgeBuses.moves).toHaveLength(1);
  });

  it('never lets an enormous kilometre figure produce a non-finite total', () => {
    const plan = planAllocation(
      [route('km', 'A', 1, 3, { A: 1e306, B: 1 })],
      [depot('A', 5), depot('B', 5)],
    );
    expect(finite(plan)).toBe(true);
  });
});

describe('away-and-back fixture', () => {
  const routes = [
    route('r0', 'B', 2, 3, { A: 1.7, B: 26.4 }),
    route('r1', 'A', 1, 4, { A: 11.2, B: 7.9, C: 12.7 }),
    route('r2', 'A', 2, 6, { A: 24.6, B: 6.4, C: 20.2 }),
    route('r3', 'B', 1, 5, { A: 15.5, B: 18.8, C: 23.7 }),
    route('r4', 'C', 1, 4, { A: 9, C: 5.7 }),
    route('r5', 'C', 1, 5, { A: 22.9, B: 10.8, C: 22.9 }),
  ];
  const depots = [depot('A', 5), depot('B', 3), depot('C', 3)];

  it('does not report a route that ends where it began, though it was relocated on the way', () => {
    const { plan } = runAllocation(routes, depots);
    expect(plan.unchanged.find((u) => u.routeName === 'r1')).toEqual({
      routeName: 'r1',
      reason: 'no_capacity',
    });
    expect(plan.moves.some((m) => m.routeName === 'r1')).toBe(false);
    const summed = plan.moves.reduce((s, m) => s + Math.round(m.savedKmPerDay * 10), 0) / 10;
    expect(plan.savedKmPerDay).toBe(summed);
  });

  it('saves 260.3 km a day and relocated routes more than once', () => {
    const run = runAllocation(routes, depots);
    expect(run.plan.savedKmPerDay).toBe(260.3);
    expect(run.shifts + run.swaps * 2).toBeGreaterThanOrEqual(2);
  });
});
