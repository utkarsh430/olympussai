import { describe, expect, it } from 'vitest';
import { planAllocation } from '@/lib/depot/optimise/allocate';
import {
  MAX_MOVES,
  MIN_SAVING_KM_PER_DAY,
} from '@/lib/depot/optimise/allocateConfig';
import type {
  AllocDepot,
  AllocRoute,
  AllocationPlan,
} from '@/lib/depot/optimise/allocateTypes';

function route(
  routeName: string,
  currentDepotId: string,
  deadKmByDepot: Record<string, number>,
  busesNeeded = 1,
  tripsPerDay = 1,
): AllocRoute {
  return { routeName, currentDepotId, busesNeeded, tripsPerDay, deadKmByDepot };
}

const depot = (depotId: string, capacity: number): AllocDepot => ({ depotId, capacity });

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value as object).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/** mulberry32: a seeded generator so shuffles and scenarios are reproducible. */
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

function shuffled<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function loadsOf(
  routes: readonly AllocRoute[],
  moves: AllocationPlan['moves'],
): Map<string, number> {
  const to = new Map(moves.map((m) => [m.routeName, m.toDepotId]));
  const loads = new Map<string, number>();
  for (const r of routes) {
    const at = to.get(r.routeName) ?? r.currentDepotId;
    loads.set(at, (loads.get(at) ?? 0) + r.busesNeeded);
  }
  return loads;
}

function startLoads(routes: readonly AllocRoute[]): Map<string, number> {
  return loadsOf(routes, []);
}

function tenths(km: number): number {
  return Math.round(km * 10);
}

function assertInvariants(
  routes: readonly AllocRoute[],
  depots: readonly AllocDepot[],
  plan: AllocationPlan,
): void {
  const cap = new Map(depots.map((d) => [d.depotId, d.capacity]));
  const before = startLoads(routes);
  const after = loadsOf(routes, plan.moves);
  for (const [id, load] of after) {
    const start = before.get(id) ?? 0;
    const limit = cap.get(id);
    if (start > (limit ?? 0)) expect(load).toBeLessThanOrEqual(start);
    else expect(load).toBeLessThanOrEqual(limit ?? 0);
  }
  expect(plan.afterKmPerDay).toBeLessThanOrEqual(plan.beforeKmPerDay);
  expect(tenths(plan.beforeKmPerDay) - tenths(plan.afterKmPerDay)).toBe(tenths(plan.savedKmPerDay));
  const sum = plan.moves.reduce((s, m) => s + tenths(m.savedKmPerDay), 0);
  expect(sum).toBe(tenths(plan.savedKmPerDay));
  for (const m of plan.moves) {
    expect(m.savedKmPerDay).toBeGreaterThanOrEqual(MIN_SAVING_KM_PER_DAY);
    expect(m.fromDepotId).not.toBe(m.toDepotId);
  }
  expect(plan.moves.length).toBeLessThanOrEqual(MAX_MOVES);
  const names = [...plan.moves.map((m) => m.routeName), ...plan.unchanged.map((u) => u.routeName)];
  expect(names.sort()).toEqual(routes.map((r) => r.routeName).sort());
  expect(new Set(names).size).toBe(names.length);
  expect(JSON.stringify(plan)).not.toMatch(/NaN|Infinity|null/);
}

describe('planAllocation: reasons', () => {
  it('leaves a route at its cheapest depot as already_best', () => {
    const routes = [route('R1', 'A', { A: 10, B: 40 })];
    const plan = planAllocation(routes, [depot('A', 1), depot('B', 5)]);
    expect(plan.moves).toEqual([]);
    expect(plan.unchanged).toEqual([{ routeName: 'R1', reason: 'already_best' }]);
    expect(plan.savedKmPerDay).toBe(0);
  });

  it('treats a tie with the current depot as already_best, never a zero-saving move', () => {
    const plan = planAllocation([route('R1', 'A', { A: 20, B: 20 })], [depot('A', 1), depot('B', 5)]);
    expect(plan.moves).toEqual([]);
    expect(plan.unchanged[0]!.reason).toBe('already_best');
  });

  it('moves at exactly the minimum saving and not below it', () => {
    const atMin = planAllocation(
      [route('R1', 'A', { A: 20 + MIN_SAVING_KM_PER_DAY, B: 20 })],
      [depot('A', 1), depot('B', 5)],
    );
    expect(atMin.moves).toHaveLength(1);
    expect(atMin.moves[0]!.savedKmPerDay).toBe(MIN_SAVING_KM_PER_DAY);
    const below = planAllocation(
      [route('R1', 'A', { A: 20 + MIN_SAVING_KM_PER_DAY - 0.1, B: 20 })],
      [depot('A', 1), depot('B', 5)],
    );
    expect(below.moves).toEqual([]);
    expect(below.unchanged).toEqual([{ routeName: 'R1', reason: 'below_threshold' }]);
  });

  it('multiplies by trips per day before applying the minimum', () => {
    const plan = planAllocation(
      [route('R1', 'A', { A: 12, B: 10 }, 1, 4)],
      [depot('A', 1), depot('B', 5)],
    );
    expect(plan.moves[0]).toMatchObject({ toDepotId: 'B', savedKmPerDay: 8 });
    expect(plan.beforeKmPerDay).toBe(48);
    expect(plan.afterKmPerDay).toBe(40);
  });

  it('reports no_capacity when the cheaper depot has no room', () => {
    const routes = [route('R1', 'A', { A: 50, B: 10 }, 3)];
    const plan = planAllocation(routes, [depot('A', 3), depot('B', 2)]);
    expect(plan.moves).toEqual([]);
    expect(plan.unchanged).toEqual([{ routeName: 'R1', reason: 'no_capacity' }]);
  });

  it('reports no_candidate for a route with no figure at any other depot, or none at all', () => {
    const routes = [
      route('R1', 'A', { A: 10 }),
      route('R2', 'A', {}),
      route('R3', 'A', { Z: 1 }),
    ];
    const plan = planAllocation(routes, [depot('A', 5), depot('B', 5)]);
    expect(plan.unchanged.map((u) => u.reason)).toEqual([
      'no_candidate',
      'no_candidate',
      'no_candidate',
    ]);
  });

  it('cannot cost a route whose own depot has no figure, and leaves it out of the totals', () => {
    const routes = [route('R1', 'A', { B: 1 }), route('R2', 'A', { A: 30, B: 10 })];
    const plan = planAllocation(routes, [depot('A', 5), depot('B', 5)]);
    expect(plan.unchanged.find((u) => u.routeName === 'R1')!.reason).toBe('no_candidate');
    expect(plan.moves.map((m) => m.routeName)).toEqual(['R2']);
    expect(plan.beforeKmPerDay).toBe(30);
    expect(plan.afterKmPerDay).toBe(10);
  });

  it('only considers depots that appear in the depots list', () => {
    const plan = planAllocation([route('R1', 'A', { A: 50, GHOST: 1 })], [depot('A', 5)]);
    expect(plan.moves).toEqual([]);
    expect(plan.unchanged[0]!.reason).toBe('no_candidate');
  });
});

describe('planAllocation: construction and search', () => {
  it('processes routes by regret, so the route with no good second choice gets the scarce slot', () => {
    // Z has room for one bus. a saves 100 at Z but 95 at W (regret 5); b saves 60 at Z only.
    const routes = [
      route('a', 'A', { A: 150, Z: 50, W: 55 }),
      route('b', 'B', { B: 70, Z: 10 }),
    ];
    const depots = [depot('A', 1), depot('B', 1), depot('W', 1), depot('Z', 1)];
    const plan = planAllocation(routes, depots);
    const where = new Map(plan.moves.map((m) => [m.routeName, m.toDepotId]));
    expect(where.get('b')).toBe('Z');
    expect(where.get('a')).toBe('W');
    expect(plan.savedKmPerDay).toBe(155);
    assertInvariants(routes, depots, plan);
  });

  it('finds a swap that construction cannot: two routes each best at the other full depot', () => {
    const routes = [route('p', 'X', { X: 100, Y: 20 }, 5), route('q', 'Y', { Y: 90, X: 10 }, 5)];
    const depots = [depot('X', 5), depot('Y', 5)];
    const plan = planAllocation(routes, depots);
    expect(plan.moves.map((m) => [m.routeName, m.fromDepotId, m.toDepotId])).toEqual([
      ['p', 'X', 'Y'],
      ['q', 'Y', 'X'],
    ]);
    expect(plan.savedKmPerDay).toBe(160);
    expect(plan.moves.map((m) => m.savedKmPerDay)).toEqual([80, 80]);
    assertInvariants(routes, depots, plan);
  });

  it('does not swap when the exchange would overfill a depot', () => {
    const routes = [route('p', 'X', { X: 100, Y: 20 }, 5), route('q', 'Y', { Y: 90, X: 10 }, 6)];
    const depots = [depot('X', 5), depot('Y', 6)];
    const plan = planAllocation(routes, depots);
    expect(plan.moves).toEqual([]);
    expect(plan.unchanged.map((u) => u.reason)).toEqual(['no_capacity', 'no_capacity']);
  });

  it('reports a route moved twice once, as its net move', () => {
    // b first takes the only slot at Z; later a swap or shift may relocate it again.
    const routes = [
      route('a', 'A', { A: 100, B: 60, C: 20 }, 1),
      route('b', 'B', { B: 50, A: 40, C: 45 }, 1),
    ];
    const depots = [depot('A', 1), depot('B', 1), depot('C', 1)];
    const plan = planAllocation(routes, depots);
    const names = plan.moves.map((m) => m.routeName);
    expect(new Set(names).size).toBe(names.length);
    for (const m of plan.moves) {
      expect(m.fromDepotId).toBe(routes.find((r) => r.routeName === m.routeName)!.currentDepotId);
    }
    assertInvariants(routes, depots, plan);
  });

  it('stops at MAX_MOVES applied moves', () => {
    const count = MAX_MOVES + 50;
    const routes: AllocRoute[] = [];
    const depots: AllocDepot[] = [];
    for (let i = 0; i < count; i += 1) {
      routes.push(route(`R${String(i).padStart(4, '0')}`, `H${i}`, { [`H${i}`]: 100, [`T${i}`]: 10 }));
      depots.push(depot(`H${i}`, 1), depot(`T${i}`, 1));
    }
    const plan = planAllocation(routes, depots);
    expect(plan.moves).toHaveLength(MAX_MOVES);
    assertInvariants(routes, depots, plan);
  });
});

describe('planAllocation: over-capacity input', () => {
  it('does not repair an over-full depot, never adds to it, and improves elsewhere', () => {
    const routes = [
      route('o1', 'X', { X: 100, Y: 10, W: 10 }, 6),
      route('o2', 'X', { X: 100, Y: 10, W: 10 }, 6),
      route('m1', 'Y', { Y: 80, X: 1, W: 20 }, 2),
    ];
    const depots = [depot('X', 10), depot('Y', 10), depot('W', 10)];
    const plan = planAllocation(routes, depots);
    const moved = new Map(plan.moves.map((m) => [m.routeName, m]));
    expect(moved.has('o1')).toBe(false);
    expect(moved.has('o2')).toBe(false);
    expect(moved.get('m1')?.toDepotId).toBe('W');
    expect(loadsOf(routes, plan.moves).get('X')).toBe(12);
    assertInvariants(routes, depots, plan);
  });
});

function scenario(seed: number, routeCount: number, depotCount: number, candidates: number) {
  const rand = seeded(seed);
  const depotIds = Array.from({ length: depotCount }, (_, i) => `D${String(i).padStart(3, '0')}`);
  const routes: AllocRoute[] = [];
  for (let i = 0; i < routeCount; i += 1) {
    const current = depotIds[Math.floor(rand() * depotCount)]!;
    const km: Record<string, number> = { [current]: Math.round(rand() * 800) / 10 };
    for (let k = 0; k < candidates; k += 1) {
      km[depotIds[Math.floor(rand() * depotCount)]!] = Math.round(rand() * 800) / 10;
    }
    routes.push(
      route(`R${String(i).padStart(4, '0')}`, current, km, 1 + Math.floor(rand() * 4), 2 + Math.floor(rand() * 20)),
    );
  }
  const load = startLoads(routes);
  const depots = depotIds.map((id) => {
    const base = load.get(id) ?? 0;
    // Some depots start over capacity, some tight, some roomy.
    const slack = Math.floor(rand() * 8) - 2;
    return depot(id, Math.max(0, base + slack));
  });
  return { routes, depots };
}

describe('planAllocation: properties', () => {
  it('holds every invariant across seeded random scenarios, including over-full depots', () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const { routes, depots } = scenario(seed, 60, 8, 4);
      const plan = planAllocation(deepFreeze(routes), deepFreeze(depots));
      assertInvariants(routes, depots, plan);
    }
  });

  it('gives identical output for shuffled routes and shuffled depots', () => {
    for (let seed = 100; seed < 110; seed += 1) {
      const { routes, depots } = scenario(seed, 80, 10, 5);
      const base = planAllocation(routes, depots);
      const rand = seeded(seed * 7);
      const reshuffled = planAllocation(shuffled(routes, rand), shuffled(depots, rand));
      expect(reshuffled).toEqual(base);
    }
  });

  it('does not mutate its inputs', () => {
    const { routes, depots } = scenario(7, 40, 6, 3);
    expect(() => planAllocation(deepFreeze(routes), deepFreeze(depots))).not.toThrow();
  });

  it('plans 1,200 routes across 143 depots with ten candidates each well inside five seconds', () => {
    const { routes, depots } = scenario(42, 1200, 143, 10);
    const started = performance.now();
    const plan = planAllocation(routes, depots);
    expect(performance.now() - started).toBeLessThan(5000);
    assertInvariants(routes, depots, plan);
  });

  it('survives hostile numbers without producing NaN or Infinity', () => {
    const routes = [
      route('bad1', 'A', { A: NaN, B: 1 }),
      route('bad2', 'A', { A: 10, B: Infinity }),
      route('bad3', 'A', { A: 10, B: -4 }),
      { ...route('bad4', 'A', { A: 10, B: 1 }), tripsPerDay: NaN },
      { ...route('bad5', 'A', { A: 10, B: 1 }), busesNeeded: NaN },
    ];
    const plan = planAllocation(routes, [depot('A', 10), depot('B', NaN)]);
    expect(JSON.stringify(plan)).not.toMatch(/NaN|Infinity|null/);
    expect(plan.moves).toEqual([]);
  });

  it('handles empty input', () => {
    expect(planAllocation([], [])).toEqual({
      moves: [],
      beforeKmPerDay: 0,
      afterKmPerDay: 0,
      savedKmPerDay: 0,
      unchanged: [],
    });
  });
});
