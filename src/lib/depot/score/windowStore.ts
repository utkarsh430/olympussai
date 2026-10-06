import type { DepotSummary } from '../types';
import type { ScoreWindow } from './types';
import {
  SCORE_WINDOW_MIN,
  appendSample,
  countsOf,
  pruneSamples,
  valuesOfCounts,
  windowOf,
  windowedValues,
  type ComponentValues,
  type DepotSample,
} from './window';

/*
 * The holder of the rolling score window (ruling S42): the only state the
 * Depot Efficiency Index keeps between snapshots.
 *
 * DEPENDS ON HISTORY (summed over the samples of the last SCORE_WINDOW_MIN
 * minutes of feed time): each depot's five component values, hence the index,
 * rank, peer medians and z of every `DepotScore`, and the value, peer median,
 * z and severity of the depot exceptions that compare a depot with its peers
 * (`dark_share_high`, `off_road_high`, `on_road_low`).
 * DOES NOT: per-bus states and locations, fleet counts, state and status mixes,
 * KPIs, bus exceptions, `power_cut_cluster`, the `affected` and `fleet` counts
 * of a depot exception, and peer-group membership (present fleet size).
 *
 * What each kind of snapshot does (`observeDepots`):
 *  - Newer feed time than the last one seen: one sample per depot is added,
 *    every depot's list is pruned at that feed time, and scores use the window.
 *  - The same feed time again (a re-fetch, or the fixture rebuilt): nothing is
 *    added; scores use the window as it stands, which already holds that time.
 *  - An older feed time (the recorded fixture after live data, or a late
 *    response): nothing is added and nothing is pruned, so the window is not
 *    rewound. That snapshot is scored on its own counts, a window of one.
 *  - No usable feed time: as for an older one, with `since` null.
 *  - A process that has just started: the first snapshot is a window of one
 *    sample, so its scores equal the single-snapshot scores; `samples` says so.
 * The fixture and a stale last-good snapshot reuse one rows array, so the
 * analysis memo answers them without coming here at all.
 *
 * Bounds: at most SCORE_WINDOW_MAX_SAMPLES samples per depot, none older than
 * the window, and a depot that leaves the feed is dropped once its samples age out.
 */

export interface ScoreWindowStore {
  lastFeedMs: number | null;
  readonly byDepot: Map<string, readonly DepotSample[]>;
}

export interface WindowedScoring {
  /** Component values per depot id, for `scoreDepots`. */
  readonly values: ReadonlyMap<string, ComponentValues>;
  /** The window each depot's values were summed over. */
  readonly windows: ReadonlyMap<string, ScoreWindow>;
  /** The widest of them: what a network-wide screen states. */
  readonly window: ScoreWindow;
}

export function createScoreWindowStore(): ScoreWindowStore {
  return { lastFeedMs: null, byDepot: new Map() };
}

const GLOBAL_KEY = '__depotScoreWindowStore';
type GlobalWithStore = typeof globalThis & { [GLOBAL_KEY]?: ScoreWindowStore };

/** The one process-wide store; on `globalThis` so a dev reload does not fork it. */
export function defaultScoreWindowStore(): ScoreWindowStore {
  const holder = globalThis as GlobalWithStore;
  holder[GLOBAL_KEY] ??= createScoreWindowStore();
  return holder[GLOBAL_KEY];
}

/** Test seam: empty a store (the process-wide one by default). */
export function resetScoreWindowStore(store: ScoreWindowStore = defaultScoreWindowStore()): void {
  store.lastFeedMs = null;
  store.byDepot.clear();
}

function parseFeedMs(feedNow: string | null): number | null {
  if (feedNow === null) return null;
  const ms = Date.parse(feedNow);
  return Number.isNaN(ms) ? null : ms;
}

function addSamples(
  store: ScoreWindowStore,
  depots: readonly DepotSummary[],
  feedNow: string,
  feedMs: number,
): void {
  const seen = new Set<string>();
  for (const depot of depots) {
    seen.add(depot.id);
    const sample: DepotSample = { feedNow, feedMs, counts: countsOf(depot) };
    store.byDepot.set(depot.id, appendSample(store.byDepot.get(depot.id) ?? [], sample));
  }
  for (const [id, samples] of [...store.byDepot]) {
    if (seen.has(id)) continue;
    const kept = pruneSamples(samples, feedMs);
    if (kept.length === 0) store.byDepot.delete(id);
    else store.byDepot.set(id, kept);
  }
  store.lastFeedMs = feedMs;
}

function widest(windows: readonly ScoreWindow[]): ScoreWindow {
  const first: ScoreWindow = { lengthMin: SCORE_WINDOW_MIN, since: null, samples: 0 };
  return windows.reduce((best, w) => (w.samples > best.samples ? w : best), first);
}

/**
 * Records this snapshot's counts if its feed time is newer than any seen, and
 * returns the values every depot is to be scored on. Called once per snapshot
 * (the analysis is memoised on the rows array), and safe to call again: a
 * repeated or older feed time never changes the store.
 */
export function observeDepots(
  store: ScoreWindowStore,
  depots: readonly DepotSummary[],
  feedNow: string | null,
): WindowedScoring {
  const feedMs = parseFeedMs(feedNow);
  const isOlder = feedMs === null || (store.lastFeedMs !== null && feedMs < store.lastFeedMs);
  if (feedNow !== null && feedMs !== null && !isOlder && feedMs !== store.lastFeedMs) {
    addSamples(store, depots, feedNow, feedMs);
  }
  const values = new Map<string, ComponentValues>();
  const windows = new Map<string, ScoreWindow>();
  for (const depot of depots) {
    const held = isOlder ? [] : (store.byDepot.get(depot.id) ?? []);
    if (held.length === 0) {
      values.set(depot.id, valuesOfCounts(countsOf(depot)));
      windows.set(depot.id, { lengthMin: SCORE_WINDOW_MIN, since: feedNow, samples: 1 });
    } else {
      values.set(depot.id, windowedValues(held));
      windows.set(depot.id, windowOf(held));
    }
  }
  return { values, windows, window: widest([...windows.values()]) };
}
