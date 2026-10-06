import { SCORE_WINDOW_MIN } from './window';

/*
 * Stragglers and epochs (ruling S56b), one rule for both holders that outlive
 * a snapshot: the score window and the yard memory.
 *
 * A sample more than one window behind the newest feed time a holder has seen
 * is a straggler: an upstream cache stuck in the past (seen live) or a clock
 * that really went back. One straggler must not cost twenty minutes of window,
 * so it is used on its own and the holder is not touched. Only
 * NEW_EPOCH_AFTER_BEHIND stragglers IN A ROW, with no current sample between
 * them, say the clock really went back: the holder then starts a new epoch
 * (forgets everything) and accepts the last of them. The fixture and a
 * snapshot with no feed time never reach this rule, so they never count.
 */

/** Stragglers in a row that start a new epoch. */
export const NEW_EPOCH_AFTER_BEHIND = 3;
/** Further behind the newest than this, a sample is a straggler. */
export const BEHIND_AFTER_MS = SCORE_WINDOW_MIN * 60_000;

/** The part of a holder this rule reads. */
export interface EpochState {
  readonly lastFeedMs: number | null;
  /** Stragglers seen in a row since the last current sample. */
  readonly behindRun: number;
}

/**
 * `current`: newer than the newest, or behind it by no more than one window.
 * `behind`: a straggler, used alone. `new_epoch`: the straggler that completes
 * the run; the holder is emptied and then accepts it.
 */
export type Arrival = 'current' | 'behind' | 'new_epoch';

export interface ArrivalDecision {
  readonly arrival: Arrival;
  /** The holder's `behindRun` after this sample. */
  readonly behindRun: number;
}

export function arrivalOf(state: EpochState, feedMs: number): ArrivalDecision {
  if (state.lastFeedMs === null || state.lastFeedMs - feedMs <= BEHIND_AFTER_MS) {
    return { arrival: 'current', behindRun: 0 };
  }
  const run = state.behindRun + 1;
  return run >= NEW_EPOCH_AFTER_BEHIND
    ? { arrival: 'new_epoch', behindRun: 0 }
    : { arrival: 'behind', behindRun: run };
}
