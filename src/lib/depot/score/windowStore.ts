import type { DepotSummary } from '../types';
import type { ScoreWindow } from './types';
import { arrivalOf, type BehindRun } from './epoch';
import {
  SCORE_WINDOW_MIN,
  insertSample,
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
 * What each kind of snapshot does (`observeDepots`, rulings S50b and S56b):
 *  - Newer feed time than any seen: one sample per depot is added, every
 *    depot's list is pruned at that feed time, and scores use the window.
 *  - A feed time already held (a re-fetch with new rows): that sample is
 *    replaced by the new counts, and scores use the window.
 *  - An older feed time still inside the window (upstream answered from an
 *    older cache, as seen live): inserted in feed-time order and scored on the
 *    window as it then stands, up to its own feed time (N7).
 *  - A feed time more than one window behind the newest (a straggler, see
 *    epoch.ts): scored on its own counts; the store is not touched. A run of
 *    stragglers that is coherent and lasting (epoch.ts: at least three, each
 *    later than the one before, spanning three minutes of feed time, with no
 *    current sample between) starts a new epoch: the store is emptied and the
 *    straggler that completes the run accepted.
 *  - The recorded fixture (`fixture: true`) or no usable feed time: the store
 *    is neither read nor written, nor is the straggler run; the snapshot is
 *    scored on its own counts.
 *
 * Order. Within an epoch the store's stored samples depend only on WHICH
 * current samples arrived, not on their order: a sample is kept exactly when
 * it is within one window of the newest feed time held. What is NOT
 * order-free: a sample counts as a straggler (and is then scored alone and
 * never stored) by the newest feed time seen when it arrives; a repeated feed
 * time keeps the last rows to arrive; the straggler run itself depends on
 * order (A at T, B at T+15 min, then C at T-6 min leaves a run of one; A, C,
 * B leaves none, with the same samples stored); so whether and when an epoch
 * starts depends on the order of arrivals, and everything before it is then
 * forgotten.
 *  - A process that has just started: the first snapshot is a window of one
 *    sample, so its scores equal the single-snapshot scores; `samples` says so.
 * The fixture and a stale last-good snapshot reuse one rows array, so the
 * analysis memo answers them without coming here at all.
 *
 * Bounds: at most SCORE_WINDOW_MAX_SAMPLES samples per depot, none older than
 * the window, a depot that leaves the feed is dropped once its samples age
 * out, and never more than SCORE_WINDOW_MAX_DEPOTS depots (the least recently
 * seen go first, as in the yard memory).
 */

export interface ScoreWindowStore {
  lastFeedMs: number | null;
  /** The current run of stragglers (ruling S56b, P1); null when there is none. */
  behindRun: BehindRun | null;
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
  return { lastFeedMs: null, behindRun: null, byDepot: new Map() };
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
  store.behindRun = null;
  store.byDepot.clear();
}

function parseFeedMs(feedNow: string | null): number | null {
  if (feedNow === null) return null;
  const ms = Date.parse(feedNow);
  return Number.isNaN(ms) ? null : ms;
}

/** As many depots as the yard memory keeps; a feed of garbage ids cannot grow it further. */
export const SCORE_WINDOW_MAX_DEPOTS = 1000;
export { NEW_EPOCH_AFTER_BEHIND } from './epoch';

export interface ObserveOptions {
  /** The recorded fixture: scored on its own counts and never offered to the store. */
  readonly fixture?: boolean;
}

/** Least recently seen first: by each depot's newest sample, then by id. */
function capDepots(store: ScoreWindowStore): void {
  const excess = store.byDepot.size - SCORE_WINDOW_MAX_DEPOTS;
  if (excess <= 0) return;
  const lastMs = (samples: readonly DepotSample[]): number => samples.at(-1)?.feedMs ?? -Infinity;
  const oldestFirst = [...store.byDepot].sort(
    ([idA, a], [idB, b]) => lastMs(a) - lastMs(b) || (idA < idB ? -1 : idA > idB ? 1 : 0),
  );
  for (const [id] of oldestFirst.slice(0, excess)) store.byDepot.delete(id);
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
    store.byDepot.set(depot.id, insertSample(store.byDepot.get(depot.id) ?? [], sample));
  }
  if (store.lastFeedMs === null || feedMs > store.lastFeedMs) {
    for (const [id, samples] of [...store.byDepot]) {
      if (seen.has(id)) continue;
      const kept = pruneSamples(samples, feedMs);
      if (kept.length === 0) store.byDepot.delete(id);
      else store.byDepot.set(id, kept);
    }
    store.lastFeedMs = feedMs;
  }
  capDepots(store);
}

/** Offers a snapshot to the store (ruling S56b); true when it is now part of the window. */
function offerSamples(
  store: ScoreWindowStore,
  depots: readonly DepotSummary[],
  feedNow: string,
  feedMs: number,
): boolean {
  const { arrival, behindRun } = arrivalOf(store, feedMs);
  if (arrival === 'new_epoch') resetScoreWindowStore(store);
  store.behindRun = behindRun;
  if (arrival === 'behind') return false;
  addSamples(store, depots, feedNow, feedMs);
  return true;
}

function widest(windows: readonly ScoreWindow[]): ScoreWindow {
  const first: ScoreWindow = {
    lengthMin: SCORE_WINDOW_MIN,
    since: null,
    samples: 0,
    coveredMin: 0,
  };
  return windows.reduce((best, w) => (w.samples > best.samples ? w : best), first);
}

/**
 * Records this snapshot's counts (see the top of this file for each kind of
 * snapshot) and returns the values every depot is to be scored on. Called
 * once per snapshot: the analysis is memoised on the rows array.
 */
export function observeDepots(
  store: ScoreWindowStore,
  depots: readonly DepotSummary[],
  feedNow: string | null,
  options: ObserveOptions = {},
): WindowedScoring {
  const feedMs = parseFeedMs(feedNow);
  const useStore =
    feedNow !== null &&
    feedMs !== null &&
    options.fixture !== true &&
    offerSamples(store, depots, feedNow, feedMs);
  const values = new Map<string, ComponentValues>();
  const windows = new Map<string, ScoreWindow>();
  for (const depot of depots) {
    // Only samples in [feedMs - window, feedMs] (N7): a late snapshot is never scored on, or
    // states a span reaching, samples newer than itself; the newest is unaffected.
    const held = useStore ? pruneSamples(store.byDepot.get(depot.id) ?? [], feedMs) : [];
    if (held.length === 0) {
      values.set(depot.id, valuesOfCounts(countsOf(depot)));
      windows.set(depot.id, {
        lengthMin: SCORE_WINDOW_MIN,
        since: feedNow,
        samples: 1,
        coveredMin: 0,
      });
    } else {
      values.set(depot.id, windowedValues(held));
      windows.set(depot.id, windowOf(held));
    }
  }
  return { values, windows, window: widest([...windows.values()]) };
}
