import type { DepotBusRow } from '@/models/depotLive';
import type { Yard } from './types';
import { YARD_HOLD_MAX_MS, continueYard, type RememberedYard } from './yardContinuity';

/*
 * The holder of yard continuity (ruling S43): per depot, the last yard the
 * process established or held. The rule itself is in yardContinuity.ts.
 *
 *  - Newer feed time than the last one seen: every depot in the snapshot is
 *    decided against its remembered yard and the memory is updated.
 *  - The same feed time again: decided against the memory, which is not
 *    written, so a repeated snapshot changes nothing.
 *  - An older feed time, or none: the single-snapshot rule alone; the memory
 *    is neither read nor written, so it is never fed out of order.
 *  - A process that has just started remembers nothing: the full rule applies.
 *  - The fixture is one constant snapshot, so it simply keeps the yards the
 *    rule gives it.
 * Bounds: one entry per depot, dropped when the depot's yard has not been seen
 * for YARD_HOLD_MAX_HOURS of feed time, and never more than
 * YARD_MEMORY_MAX_DEPOTS entries (the least recently seen go first).
 */

export const YARD_MEMORY_MAX_DEPOTS = 1000;

export interface YardMemoryStore {
  lastFeedMs: number | null;
  readonly byDepot: Map<string, RememberedYard>;
}

export function createYardMemoryStore(): YardMemoryStore {
  return { lastFeedMs: null, byDepot: new Map() };
}

const GLOBAL_KEY = '__depotYardMemoryStore';
type GlobalWithStore = typeof globalThis & { [GLOBAL_KEY]?: YardMemoryStore };

/** The one process-wide store; on `globalThis` so a dev reload does not fork it. */
export function defaultYardMemoryStore(): YardMemoryStore {
  const holder = globalThis as GlobalWithStore;
  holder[GLOBAL_KEY] ??= createYardMemoryStore();
  return holder[GLOBAL_KEY];
}

/** Test seam: empty a store (the process-wide one by default). */
export function resetYardMemoryStore(store: YardMemoryStore = defaultYardMemoryStore()): void {
  store.lastFeedMs = null;
  store.byDepot.clear();
}

function rowsByDepot(rows: readonly DepotBusRow[]): Map<string, DepotBusRow[]> {
  const groups = new Map<string, DepotBusRow[]>();
  for (const row of rows) {
    if (row.depotId === null) continue;
    const group = groups.get(row.depotId);
    if (group) group.push(row);
    else groups.set(row.depotId, [row]);
  }
  return groups;
}

function prune(store: YardMemoryStore, feedMs: number): void {
  for (const [id, entry] of [...store.byDepot]) {
    if (feedMs - entry.seenMs > YARD_HOLD_MAX_MS) store.byDepot.delete(id);
  }
  const excess = store.byDepot.size - YARD_MEMORY_MAX_DEPOTS;
  if (excess <= 0) return;
  const oldestFirst = [...store.byDepot].sort(
    ([idA, a], [idB, b]) => a.seenMs - b.seenMs || (idA < idB ? -1 : idA > idB ? 1 : 0),
  );
  for (const [id] of oldestFirst.slice(0, excess)) store.byDepot.delete(id);
}

/**
 * The yards every page uses on this snapshot: the single-snapshot yards with
 * continuity applied. Returns a new map; `ruleYards` is not changed.
 */
export function applyYardContinuity(
  store: YardMemoryStore,
  rows: readonly DepotBusRow[],
  ruleYards: ReadonlyMap<string, Yard>,
  feedNow: string | null,
): ReadonlyMap<string, Yard> {
  const feedMs = feedNow === null ? Number.NaN : Date.parse(feedNow);
  const last = store.lastFeedMs;
  if (feedNow === null || Number.isNaN(feedMs) || (last !== null && feedMs < last)) {
    return new Map(ruleYards);
  }
  const isRepeat = feedMs === last;
  const groups = rowsByDepot(rows);
  const yards = new Map<string, Yard>();
  for (const id of [...groups.keys()].sort()) {
    const decision = continueYard(
      store.byDepot.get(id) ?? null,
      ruleYards.get(id) ?? null,
      groups.get(id) ?? [],
      feedNow,
      feedMs,
    );
    if (decision.yard) yards.set(id, decision.yard);
    if (isRepeat) continue;
    if (decision.remembered) store.byDepot.set(id, decision.remembered);
    else store.byDepot.delete(id);
  }
  if (!isRepeat) {
    prune(store, feedMs);
    store.lastFeedMs = feedMs;
  }
  return yards;
}
