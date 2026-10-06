import {
  COST_GRID_M,
  MAX_BUSES,
  MAX_MOVES,
  MAX_TRIPS_PER_DAY,
  METRES_PER_KM,
} from './allocateConfig';
import {
  compareText,
  dailyCost,
  fits,
  localSearch,
  MIN_SAVING_M,
  movable,
  routesWithMove,
  shiftTo,
  type Work,
} from './allocateSearch';
import type {
  AllocDepot,
  AllocRoute,
  AllocationPlan,
  RouteMove,
  UnchangedReason,
  UnchangedRoute,
} from './allocateTypes';

export { MAX_MOVES, MIN_SAVING_KM_PER_DAY } from './allocateConfig';

const isCount = (n: number): boolean => Number.isFinite(n) && n >= 0;
/** A whole, non-negative count no larger than `max`: anything else is a data error. */
const isWholeCount = (n: number, max: number): boolean =>
  Number.isInteger(n) && n >= 0 && n <= max;

function capacities(depots: readonly AllocDepot[]): Map<string, number> {
  const cap = new Map<string, number>();
  for (const d of depots) {
    const value = isCount(d.capacity) ? d.capacity : 0;
    // A depot listed twice is held to the smaller figure: never assume room.
    cap.set(d.depotId, Math.min(cap.get(d.depotId) ?? value, value));
  }
  return cap;
}

function buildWork(routes: readonly AllocRoute[], cap: ReadonlyMap<string, number>): Work[] {
  const sorted = [...routes].sort(
    (a, b) => compareText(a.routeName, b.routeName) || compareText(a.currentDepotId, b.currentDepotId),
  );
  const loads = new Map<string, number>();
  for (const r of sorted) {
    const buses = isCount(r.busesNeeded) ? r.busesNeeded : 0;
    loads.set(r.currentDepotId, (loads.get(r.currentDepotId) ?? 0) + buses);
  }
  return sorted.map((r, index) => {
    const usable =
      isWholeCount(r.busesNeeded, MAX_BUSES) && isWholeCount(r.tripsPerDay, MAX_TRIPS_PER_DAY);
    const cost = new Map<string, number>();
    if (usable) {
      for (const [id, km] of Object.entries(r.deadKmByDepot)) {
        if (!isCount(km)) continue;
        const metres = dailyCost(km, r.tripsPerDay);
        // An absurd kilometre figure would leave the exact-integer range: skip it.
        if (Number.isSafeInteger(metres)) cost.set(id, metres);
      }
    }
    const costed = cost.has(r.currentDepotId);
    const options = costed ? [...cost.keys()].filter((id) => cap.has(id) || id === r.currentDepotId) : [];
    const limit = cap.get(r.currentDepotId);
    return {
      index,
      name: r.routeName,
      origin: r.currentDepotId,
      current: r.currentDepotId,
      buses: isCount(r.busesNeeded) ? r.busesNeeded : 0,
      cost,
      costed,
      options: options.sort(compareText),
      optionSet: new Set(options),
      frozen: limit !== undefined && (loads.get(r.currentDepotId) ?? 0) > limit,
    };
  });
}

/** Phase 1: routes in regret order each take their best depot that still has room. */
function construct(
  works: readonly Work[],
  cap: ReadonlyMap<string, number>,
  loads: Map<string, number>,
  budget: number,
): number {
  const savingsOf = (w: Work): number[] =>
    w.options
      .filter((id) => id !== w.current && fits(loads, cap, id, w.buses))
      .map((id) => w.cost.get(w.current)! - w.cost.get(id)!)
      .sort((a, b) => b - a);
  const ranked = movable(works)
    .map((w) => ({ w, s: savingsOf(w) }))
    .filter((x) => x.s.length > 0)
    .map((x) => ({ w: x.w, regret: x.s[0]! - (x.s[1] ?? 0) }))
    .sort((a, b) => b.regret - a.regret || compareText(a.w.name, b.w.name));
  let applied = 0;
  for (const { w } of ranked) {
    if (applied >= budget) break;
    let target: string | null = null;
    for (const id of w.options) {
      if (id === w.current || !fits(loads, cap, id, w.buses)) continue;
      if (target === null || w.cost.get(id)! < w.cost.get(target)!) target = id;
    }
    if (target === null || w.cost.get(w.current)! - w.cost.get(target)! < MIN_SAVING_M) continue;
    shiftTo(loads, w, target);
    applied += 1;
  }
  return applied;
}

function reasonFor(w: Work, limited: ReadonlySet<string>): UnchangedReason {
  const others = w.options.filter((id) => id !== w.origin);
  if (!w.costed || others.length === 0) return 'no_candidate';
  const saving = w.cost.get(w.origin)! - Math.min(...others.map((id) => w.cost.get(id)!));
  if (saving <= 0) return 'already_best';
  if (saving < MIN_SAVING_M) return 'below_threshold';
  if (w.frozen) return 'over_capacity';
  return limited.has(w.name) ? 'move_limit' : 'no_capacity';
}

const toKm = (metres: number): number => Math.round(metres / COST_GRID_M) / (METRES_PER_KM / COST_GRID_M);

export interface AllocationRun {
  readonly plan: AllocationPlan;
  /** Applied single-route shifts (both phases) and swaps; diagnostics for tests. */
  readonly shifts: number;
  readonly swaps: number;
}

/**
 * Recommends which depot should run each route to cut dead kilometres within
 * capacity. Starts from the current allocation and only applies shifts and
 * swaps that save at least the minimum in total, so the result is feasible and
 * never worse. Output depends only on input values, not their order.
 */
export function planAllocation(
  routes: readonly AllocRoute[],
  depots: readonly AllocDepot[],
): AllocationPlan {
  return runAllocation(routes, depots).plan;
}

export function runAllocation(
  routes: readonly AllocRoute[],
  depots: readonly AllocDepot[],
): AllocationRun {
  const cap = capacities(depots);
  const works = buildWork(routes, cap);
  const loads = new Map<string, number>();
  for (const w of works) loads.set(w.origin, (loads.get(w.origin) ?? 0) + w.buses);

  const constructed = construct(works, cap, loads, MAX_MOVES);
  const searched = localSearch(works, cap, loads, MAX_MOVES - constructed);
  const spent = constructed + searched.shifts + searched.swaps * 2;
  // With room for at most one more relocation a swap is no longer possible: name what that cost.
  const limited = spent >= MAX_MOVES - 1 ? routesWithMove(works, cap, loads) : new Set<string>();

  const moves: RouteMove[] = [];
  const unchanged: UnchangedRoute[] = [];
  let before = 0;
  let after = 0;
  for (const w of works) {
    if (w.costed) {
      before += w.cost.get(w.origin)!;
      after += w.cost.get(w.current)!;
    }
    if (w.current === w.origin) {
      unchanged.push({ routeName: w.name, reason: reasonFor(w, limited) });
      continue;
    }
    const saved = w.cost.get(w.origin)! - w.cost.get(w.current)!;
    moves.push({
      routeName: w.name,
      fromDepotId: w.origin,
      toDepotId: w.current,
      busesNeeded: w.buses,
      savedKmPerDay: toKm(saved),
      madeRoom: saved < MIN_SAVING_M,
    });
  }
  const plan = {
    moves,
    beforeKmPerDay: toKm(before),
    afterKmPerDay: toKm(after),
    savedKmPerDay: toKm(before - after),
    unchanged,
  };
  return { plan, shifts: constructed + searched.shifts, swaps: searched.swaps };
}
