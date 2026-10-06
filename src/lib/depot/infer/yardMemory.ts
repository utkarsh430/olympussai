import type { DepotBusRow } from '@/models/depotLive';
import type { Yard } from './types';
import { arrivalOf } from '../score/epoch';
import { YARD_HOLD_MAX_MS, continueYard, type RememberedYard } from './yardContinuity';

/*
 * The holder of yard continuity (ruling S43): per depot, the last yard the
 * process established or held. The rule itself is in yardContinuity.ts.
 *
 *  - Newer feed time than the last one seen: entries too old to hold are
 *    pruned FIRST, then every depot in the snapshot is decided against its
 *    remembered yard and the memory is updated.
 *  - The same feed time again (a re-fetch with new rows): each depot gets
 *    exactly the yard decided at that feed time, or none if none was; the
 *    memory is not written, so polls of one feed time agree (ruling S50c).
 *  - An older feed time: decided against the memory, which is not written,
 *    so it is never fed out of order and a late response still sees the yard.
 *  - More than one score window behind the newest (a straggler, ruling S56b,
 *    see score/epoch.ts): the same, and counted; the third in a row, with no
 *    current snapshot between, starts a new epoch: the memory is emptied, then
 *    written as for a first snapshot. So a clock that really went back does
 *    not leave entries from its future deciding every depot for hours.
 *  - No usable feed time, or the recorded fixture: the single-snapshot rule
 *    alone; the memory is neither read nor written, and nothing is counted.
 *  - A process that has just started remembers nothing: the full rule applies.
 * Bounds: one entry per depot, dropped when the depot's yard has not been seen
 * for YARD_HOLD_MAX_HOURS of feed time, and never more than
 * YARD_MEMORY_MAX_DEPOTS entries (the least recently seen go first).
 */

export const YARD_MEMORY_MAX_DEPOTS = 1000;

export interface YardMemoryStore {
  lastFeedMs: number | null;
  /** Stragglers seen in a row (ruling S56b). */
  behindRun: number;
  readonly byDepot: Map<string, RememberedYard>;
  /** Depots decided at `lastFeedMs`, so a repeat can tell "no yard" from "never seen". */
  decidedAtLast: ReadonlySet<string>;
}

export function createYardMemoryStore(): YardMemoryStore {
  return { lastFeedMs: null, behindRun: 0, byDepot: new Map(), decidedAtLast: new Set() };
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
  store.behindRun = 0;
  store.byDepot.clear();
  store.decidedAtLast = new Set();
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

export interface YardContinuityOptions {
  /** The recorded fixture: the rule alone; the memory is neither read nor written. */
  readonly fixture?: boolean;
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
  options: YardContinuityOptions = {},
): ReadonlyMap<string, Yard> {
  const feedMs = feedNow === null ? Number.NaN : Date.parse(feedNow);
  if (feedNow === null || Number.isNaN(feedMs) || options.fixture === true) {
    return new Map(ruleYards);
  }
  const { arrival, behindRun } = arrivalOf(store, feedMs);
  if (arrival === 'new_epoch') resetYardMemoryStore(store);
  store.behindRun = behindRun;
  const last = store.lastFeedMs;
  const writes = last === null || feedMs > last;
  const isRepeat = feedMs === last;
  if (writes) prune(store, feedMs);
  const groups = rowsByDepot(rows);
  const yards = new Map<string, Yard>();
  for (const id of [...groups.keys()].sort()) {
    const remembered = store.byDepot.get(id) ?? null;
    if (isRepeat && remembered === null && store.decidedAtLast.has(id)) continue;
    const decision = continueYard(
      remembered,
      ruleYards.get(id) ?? null,
      groups.get(id) ?? [],
      feedNow,
      feedMs,
    );
    if (decision.yard) yards.set(id, decision.yard);
    if (!writes) continue;
    if (decision.remembered) store.byDepot.set(id, decision.remembered);
    else store.byDepot.delete(id);
  }
  if (writes) {
    prune(store, feedMs);
    store.lastFeedMs = feedMs;
    store.decidedAtLast = new Set(groups.keys());
  }
  return yards;
}

/** Stub until N10 lands. */
export function yardSnapshotsSeen(store: YardMemoryStore, depotId: string): number {
  return store.byDepot.has(depotId) ? 0 : 0;
}
