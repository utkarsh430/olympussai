import { SCORE_WINDOW_MIN } from './window';

/*
 * Stragglers and epochs, one rule for both
 * holders that outlive a snapshot: the score window and the yard memory.
 *
 * A sample more than one window behind the newest feed time a holder has seen
 * is a straggler: an upstream cache stuck in the past (seen live) or a clock
 * that really went back. One straggler must not cost twenty minutes of window,
 * so it is used on its own and the holder is not touched. Stragglers form a
 * run; the holder starts a new epoch (forgets everything and accepts the
 * straggler) only when the run is coherent and lasting: at least
 * NEW_EPOCH_AFTER_BEHIND stragglers spanning at least EPOCH_RUN_MIN_SPAN_MS of
 * their own feed time. A cache answering one old snapshot again and again
 * never spans anything; a clock that stepped back and keeps advancing does.
 *
 * What each arrival does to the run:
 *  - current (newer than the newest, or behind it by no more than one window):
 *    the run is broken (emptied);
 *  - a straggler later than the run's previous one and within one window of
 *    it, or the first straggler after an empty run: counted (it extends the
 *    run, or starts one);
 *  - a straggler at the same feed time as the run's previous one: left as is
 *    (neither counted nor broken), so a cache repeating itself adds nothing;
 *  - a straggler earlier than the run's previous one, or more than one window
 *    after it: the run is broken and a new run starts at this straggler.
 * The fixture and a snapshot with no feed time never reach this rule.
 */

/** The least number of stragglers in a run that starts a new epoch. */
export const NEW_EPOCH_AFTER_BEHIND = 3;
/** Feed time a run of stragglers must span before it starts a new epoch. */
export const EPOCH_RUN_MIN_SPAN_MS = 3 * 60_000;
/** Further behind the newest than this, a sample is a straggler. */
export const BEHIND_AFTER_MS = SCORE_WINDOW_MIN * 60_000;

/** Stragglers seen since the last current sample, in one coherent run. */
export interface BehindRun {
  readonly count: number;
  /** Feed time, in ms, of the run's first straggler. */
  readonly firstMs: number;
  /** Feed time, in ms, of the run's latest straggler. */
  readonly lastMs: number;
}

/** The part of a holder this rule reads. */
export interface EpochState {
  readonly lastFeedMs: number | null;
  readonly behindRun: BehindRun | null;
}

/**
 * `current`: newer than the newest, or behind it by no more than one window.
 * `behind`: a straggler, used alone. `new_epoch`: the straggler that completes
 * the run; the holder is emptied and then accepts it.
 */
export type Arrival = 'current' | 'behind' | 'new_epoch';

export interface ArrivalDecision {
  readonly arrival: Arrival;
  /** The holder's run after this sample. */
  readonly behindRun: BehindRun | null;
}

function extendsRun(run: BehindRun, feedMs: number): boolean {
  return feedMs > run.lastMs && feedMs - run.lastMs <= BEHIND_AFTER_MS;
}

export function arrivalOf(state: EpochState, feedMs: number): ArrivalDecision {
  if (state.lastFeedMs === null || state.lastFeedMs - feedMs <= BEHIND_AFTER_MS) {
    return { arrival: 'current', behindRun: null };
  }
  const run = state.behindRun;
  if (run !== null && feedMs === run.lastMs) return { arrival: 'behind', behindRun: run };
  const next: BehindRun =
    run !== null && extendsRun(run, feedMs)
      ? { count: run.count + 1, firstMs: run.firstMs, lastMs: feedMs }
      : { count: 1, firstMs: feedMs, lastMs: feedMs };
  const complete =
    next.count >= NEW_EPOCH_AFTER_BEHIND && next.lastMs - next.firstMs >= EPOCH_RUN_MIN_SPAN_MS;
  return complete ? { arrival: 'new_epoch', behindRun: null } : { arrival: 'behind', behindRun: next };
}
