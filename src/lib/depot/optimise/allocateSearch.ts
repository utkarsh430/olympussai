import { METRES_PER_KM } from '@/lib/depot/units';
import { COST_GRID_M, MIN_SAVING_KM_PER_DAY } from './allocateConfig';

export const MIN_SAVING_M = MIN_SAVING_KM_PER_DAY * METRES_PER_KM;

/** One route's working state. Mutated only by the allocator, never the caller's input. */
export interface Work {
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

export interface Candidate {
  /** Total saving of the shift or swap, in metres per day. */
  readonly saving: number;
  readonly primary: Work;
  readonly toDepot: string;
  readonly partner: Work | null;
}

export interface SearchResult {
  readonly shifts: number;
  readonly swaps: number;
}

export const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Whole-number metres on the cost grid: the true daily distance (whole metres
 * per trip times whole trips) rounded once, at the end, to a tenth of a
 * kilometre. Rounding per trip first would be wrong by up to 50 m per trip.
 * For whole trips and one-decimal kilometres this equals the per-trip result.
 */
export function dailyCost(perTripKm: number, tripsPerDay: number): number {
  const perTripM = Math.round(perTripKm * METRES_PER_KM);
  return Math.round((tripsPerDay * perTripM) / COST_GRID_M) * COST_GRID_M;
}

export function fits(
  loads: ReadonlyMap<string, number>,
  cap: ReadonlyMap<string, number>,
  depot: string,
  delta: number,
): boolean {
  const limit = cap.get(depot);
  return limit !== undefined && (loads.get(depot) ?? 0) + delta <= limit;
}

export function shiftTo(loads: Map<string, number>, work: Work, depot: string): void {
  loads.set(work.current, (loads.get(work.current) ?? 0) - work.buses);
  loads.set(depot, (loads.get(depot) ?? 0) + work.buses);
  work.current = depot;
}

export function movable(works: readonly Work[]): Work[] {
  return works.filter((w) => w.costed && !w.frozen);
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

/**
 * Every shift that saves at least the minimum and fits, and every swap whose
 * total saving is at least the minimum and keeps both depots within capacity.
 * A swap leg may save little or cost something; only the whole counts.
 */
function eachMove(
  works: readonly Work[],
  cap: ReadonlyMap<string, number>,
  loads: ReadonlyMap<string, number>,
  allowSwaps: boolean,
  visit: (move: Candidate) => void,
): void {
  const live = movable(works);
  const byDepot = new Map<string, Work[]>();
  for (const w of live) byDepot.set(w.current, [...(byDepot.get(w.current) ?? []), w]);
  for (const w of live) {
    const here = w.cost.get(w.current)!;
    for (const id of w.options) {
      if (id === w.current) continue;
      const gain = here - w.cost.get(id)!;
      if (gain >= MIN_SAVING_M && fits(loads, cap, id, w.buses)) {
        visit({ saving: gain, primary: w, toDepot: id, partner: null });
      }
      for (const other of allowSwaps ? (byDepot.get(id) ?? []) : []) {
        if (other.index <= w.index || !other.optionSet.has(w.current)) continue;
        const total = gain + (other.cost.get(id)! - other.cost.get(w.current)!);
        if (total < MIN_SAVING_M) continue;
        if (!fits(loads, cap, w.current, other.buses - w.buses)) continue;
        if (!fits(loads, cap, id, w.buses - other.buses)) continue;
        visit({ saving: total, primary: w, toDepot: id, partner: other });
      }
    }
  }
}

function bestMove(
  works: readonly Work[],
  cap: ReadonlyMap<string, number>,
  loads: ReadonlyMap<string, number>,
  remaining: number,
): Candidate | null {
  let best: Candidate | null = null;
  eachMove(works, cap, loads, remaining >= 2, (move) => {
    if (better(move, best)) best = move;
  });
  return best;
}

/**
 * Phase 2: apply the single best improving shift or swap until none is left or
 * the budget is spent. Every applied move cuts total cost by at least the
 * minimum, so the search terminates and never ends worse than it started.
 * A swap relocates two routes and spends two of the budget.
 */
export function localSearch(
  works: readonly Work[],
  cap: ReadonlyMap<string, number>,
  loads: Map<string, number>,
  budget: number,
): SearchResult {
  let remaining = budget;
  let shifts = 0;
  let swaps = 0;
  while (remaining > 0) {
    const move = bestMove(works, cap, loads, remaining);
    if (move === null) break;
    const from = move.primary.current;
    shiftTo(loads, move.primary, move.toDepot);
    if (move.partner === null) {
      shifts += 1;
      remaining -= 1;
    } else {
      shiftTo(loads, move.partner, from);
      swaps += 1;
      remaining -= 2;
    }
  }
  return { shifts, swaps };
}

/** Routes with a worthwhile, feasible shift or swap in the current state, ignoring any cap. */
export function routesWithMove(
  works: readonly Work[],
  cap: ReadonlyMap<string, number>,
  loads: ReadonlyMap<string, number>,
): ReadonlySet<string> {
  const names = new Set<string>();
  eachMove(works, cap, loads, true, (move) => {
    names.add(move.primary.name);
    if (move.partner !== null) names.add(move.partner.name);
  });
  return names;
}
