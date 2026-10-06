import {
  COST_GRID_M,
  MAX_MOVES,
  METRES_PER_KM,
  MIN_SAVING_KM_PER_DAY,
} from './allocateConfig';
import type {
  AllocDepot,
  AllocRoute,
  AllocationPlan,
  RouteMove,
  UnchangedReason,
  UnchangedRoute,
} from './allocateTypes';

export { MAX_MOVES, MIN_SAVING_KM_PER_DAY } from './allocateConfig';

const MIN_SAVING_M = MIN_SAVING_KM_PER_DAY * METRES_PER_KM;

/** One route's working state. Mutated only here, never the caller's input. */
interface Work {
  readonly index: number;
  readonly name: string;
  readonly origin: string;
  current: string;
  readonly buses: number;
  /** Daily metres at each depot the route has a valid figure for. */
  readonly cost: ReadonlyMap<string, number>;
  readonly costed: boolean;
  /** Eligible depots (figure present and listed), sorted by id, own depot included. */
  readonly options: readonly string[];
  readonly optionSet: ReadonlySet<string>;
  /** Routes at a depot that starts over capacity stay where they are. */
  readonly frozen: boolean;
}

interface Candidate {
  readonly saving: number;
  readonly primary: Work;
  readonly toDepot: string;
  readonly partner: Work | null;
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const isCount = (n: number): boolean => Number.isFinite(n) && n >= 0;

function dailyCost(km: number, tripsPerDay: number): number {
  const perTripM = Math.round(km * METRES_PER_KM);
  return Math.round((tripsPerDay * perTripM) / COST_GRID_M) * COST_GRID_M;
}

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
    const usable = isCount(r.busesNeeded) && isCount(r.tripsPerDay);
    const cost = new Map<string, number>();
    if (usable) {
      for (const [id, km] of Object.entries(r.deadKmByDepot)) {
        if (isCount(km)) cost.set(id, dailyCost(km, r.tripsPerDay));
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

/** Strictly better first: saving, then route name, then target depot, shift before swap. */
function better(a: Candidate, b: Candidate | null): boolean {
  if (b === null) return true;
  if (a.saving !== b.saving) return a.saving > b.saving;
  return (
    (compareText(a.primary.name, b.primary.name) ||
      compareText(a.toDepot, b.toDepot) ||
      (a.partner === null ? 0 : 1) - (b.partner === null ? 0 : 1) ||
      compareText(a.partner?.name ?? '', b.partner?.name ?? '')) < 0
  );
}

function fits(
  loads: ReadonlyMap<string, number>,
  cap: ReadonlyMap<string, number>,
  depot: string,
  delta: number,
): boolean {
  const limit = cap.get(depot);
  return limit !== undefined && (loads.get(depot) ?? 0) + delta <= limit;
}

function shiftTo(loads: Map<string, number>, work: Work, depot: string): void {
  loads.set(work.current, (loads.get(work.current) ?? 0) - work.buses);
  loads.set(depot, (loads.get(depot) ?? 0) + work.buses);
  work.current = depot;
}

function movable(works: readonly Work[]): Work[] {
  return works.filter((w) => w.costed && !w.frozen);
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

function bestMove(
  works: readonly Work[],
  cap: ReadonlyMap<string, number>,
  loads: ReadonlyMap<string, number>,
  remaining: number,
): Candidate | null {
  const live = movable(works);
  const byDepot = new Map<string, Work[]>();
  for (const w of live) byDepot.set(w.current, [...(byDepot.get(w.current) ?? []), w]);
  let best: Candidate | null = null;
  for (const w of live) {
    const here = w.cost.get(w.current)!;
    for (const id of w.options) {
      if (id === w.current) continue;
      const gain = here - w.cost.get(id)!;
      if (gain < MIN_SAVING_M) continue;
      if (fits(loads, cap, id, w.buses)) {
        const shift = { saving: gain, primary: w, toDepot: id, partner: null };
        if (better(shift, best)) best = shift;
      }
      for (const other of remaining >= 2 ? (byDepot.get(id) ?? []) : []) {
        if (other.index <= w.index || !other.optionSet.has(w.current)) continue;
        const otherGain = other.cost.get(id)! - other.cost.get(w.current)!;
        if (otherGain < MIN_SAVING_M) continue;
        if (!fits(loads, cap, w.current, other.buses - w.buses)) continue;
        if (!fits(loads, cap, id, w.buses - other.buses)) continue;
        const swap = { saving: gain + otherGain, primary: w, toDepot: id, partner: other };
        if (better(swap, best)) best = swap;
      }
    }
  }
  return best;
}

/** Phase 2: apply the single best improving shift or swap until none is left. */
function localSearch(
  works: readonly Work[],
  cap: ReadonlyMap<string, number>,
  loads: Map<string, number>,
  budget: number,
): void {
  // A swap relocates two routes, so it spends two of the budget.
  let remaining = budget;
  while (remaining > 0) {
    const move = bestMove(works, cap, loads, remaining);
    if (move === null) return;
    const from = move.primary.current;
    shiftTo(loads, move.primary, move.toDepot);
    if (move.partner !== null) shiftTo(loads, move.partner, from);
    remaining -= move.partner === null ? 1 : 2;
  }
}

function reasonFor(w: Work): UnchangedReason {
  const others = w.options.filter((id) => id !== w.origin);
  if (!w.costed || others.length === 0) return 'no_candidate';
  const cheapest = Math.min(...others.map((id) => w.cost.get(id)!));
  const saving = w.cost.get(w.origin)! - cheapest;
  if (saving <= 0) return 'already_best';
  return saving < MIN_SAVING_M ? 'below_threshold' : 'no_capacity';
}

const toKm = (metres: number): number => Math.round(metres / COST_GRID_M) / (METRES_PER_KM / COST_GRID_M);

/**
 * Recommends which depot should run each route to cut dead kilometres within
 * capacity. Starts from the current allocation and only ever makes moves that
 * save at least the minimum, so the result is feasible and never worse.
 * Output depends only on input values, not their order.
 */
export function planAllocation(
  routes: readonly AllocRoute[],
  depots: readonly AllocDepot[],
): AllocationPlan {
  const cap = capacities(depots);
  const works = buildWork(routes, cap);
  const loads = new Map<string, number>();
  for (const w of works) loads.set(w.origin, (loads.get(w.origin) ?? 0) + w.buses);

  const constructed = construct(works, cap, loads, MAX_MOVES);
  localSearch(works, cap, loads, MAX_MOVES - constructed);

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
      unchanged.push({ routeName: w.name, reason: reasonFor(w) });
      continue;
    }
    const saved = w.cost.get(w.origin)! - w.cost.get(w.current)!;
    moves.push({
      routeName: w.name,
      fromDepotId: w.origin,
      toDepotId: w.current,
      busesNeeded: w.buses,
      savedKmPerDay: toKm(saved),
    });
  }
  return {
    moves,
    beforeKmPerDay: toKm(before),
    afterKmPerDay: toKm(after),
    savedKmPerDay: toKm(before - after),
    unchanged,
  };
}
