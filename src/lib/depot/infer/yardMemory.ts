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
  /** Per depot: the feed times its yard was decided on and written (N10). */
  readonly seenByDepot: Map<string, DepotSeen>;
}

export interface DepotSeen {
  readonly count: number;
  /** Feed time, in ms, of the latest of them. */
  readonly seenMs: number;
}

export function createYardMemoryStore(): YardMemoryStore {
  return {
    lastFeedMs: null,
    behindRun: 0,
    byDepot: new Map(),
    decidedAtLast: new Set(),
    seenByDepot: new Map(),
  };
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
  store.seenByDepot.clear();
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

/** Drops entries not seen for the hold cap, then the least recently seen past the depot cap. */
function pruneEntries(map: Map<string, { readonly seenMs: number }>, feedMs: number): void {
  for (const [id, entry] of [...map]) {
    if (feedMs - entry.seenMs > YARD_HOLD_MAX_MS) map.delete(id);
  }
  const excess = map.size - YARD_MEMORY_MAX_DEPOTS;
  if (excess <= 0) return;
  const oldestFirst = [...map].sort(
    ([idA, a], [idB, b]) => a.seenMs - b.seenMs || (idA < idB ? -1 : idA > idB ? 1 : 0),
  );
  for (const [id] of oldestFirst.slice(0, excess)) map.delete(id);
}

function prune(store: YardMemoryStore, feedMs: number): void {
  pruneEntries(store.byDepot, feedMs);
  pruneEntries(store.seenByDepot, feedMs);
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
    const count = (store.seenByDepot.get(id)?.count ?? 0) + 1;
    store.seenByDepot.set(id, { count, seenMs: feedMs });
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

/**
 * The feed times this store has decided `depotId`'s yard on (N10): since the
 * process started, the memory's last epoch, or the depot's last absence longer
 * than the hold cap. A yard can be held only from the second, so at 0 or 1 a
 * missing yard may mean a fresh start rather than refusing evidence.
 */
export function yardSnapshotsSeen(store: YardMemoryStore, depotId: string): number {
  return store.seenByDepot.get(depotId)?.count ?? 0;
}
