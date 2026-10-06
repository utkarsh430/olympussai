/*
 * The one rule both daily holders follow (`peakShareHold.ts` for the on-road
 * shares, `peakRequirementHold.ts` for the peak requirements): per depot, the
 * HIGHEST value seen so far in one operating date.
 *
 * What each offer does (`holdDailyMaxima`, once per snapshot analysis):
 *  - The same operating date as the one held: each depot's held value becomes
 *    the larger of it and this snapshot's value.
 *  - A later operating date: the store starts afresh from this snapshot's own
 *    values.
 *  - An earlier operating date (a feed clock that stepped back over midnight),
 *    or no operating date: the snapshot reads its own values; the store is
 *    neither read nor written.
 * A depot with no finite value keeps its held value where it has one; with
 * neither, it maps to null. It never reads the wall clock. Bounds: one number
 * per depot for one date, and never more than `maxDepots` depots; a depot past
 * the cap is not held and reads its own value.
 */

export interface DailyMaximaStore {
  /** The operating date (YYYY-MM-DD) the maxima belong to; null before the first snapshot. */
  operatingDate: string | null;
  readonly maxima: Map<string, number>;
}

export function createDailyMaximaStore(): DailyMaximaStore {
  return { operatingDate: null, maxima: new Map() };
}

/** Empties a store: the state of a process that has just started. */
export function resetDailyMaximaStore(store: DailyMaximaStore): void {
  store.operatingDate = null;
  store.maxima.clear();
}

const finiteOrNull = (value: number | null | undefined): number | null =>
  value !== null && value !== undefined && Number.isFinite(value) ? value : null;

function larger(held: number | undefined, value: number | null): number | null {
  if (held === undefined) return value;
  return value === null ? held : Math.max(held, value);
}

/**
 * Offers one snapshot's values to the store and returns the values it should
 * read: a new map, so the store may move on while a memoised analysis keeps
 * what it was given.
 */
export function holdDailyMaxima(
  store: DailyMaximaStore,
  values: ReadonlyMap<string, number | null>,
  operatingDate: string | null,
  maxDepots: number,
): Map<string, number | null> {
  const held = store.operatingDate;
  if (operatingDate === null || (held !== null && operatingDate < held)) return new Map(values);
  if (held !== operatingDate) {
    store.operatingDate = operatingDate;
    store.maxima.clear();
  }
  const out = new Map<string, number | null>();
  for (const [depotId, raw] of values) {
    const known = store.maxima.has(depotId);
    const value = finiteOrNull(raw);
    if (!known && store.maxima.size >= maxDepots) {
      out.set(depotId, value);
      continue;
    }
    const next = larger(store.maxima.get(depotId), value);
    if (next !== null) store.maxima.set(depotId, next);
    out.set(depotId, next);
  }
  return out;
}
