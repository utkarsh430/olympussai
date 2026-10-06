/**
 * Depot Efficiency Index types.
 *
 * The index compares a depot with peers of similar fleet size. In the live
 * analysis the rates are summed over a rolling window of snapshots (see
 * `window.ts`); `scoreDepots` alone scores one snapshot. It scores depots,
 * never individuals.
 */

export type PeerGroupId = 'small' | 'medium' | 'large' | 'all';

export type DeiComponentKey = 'onRoad' | 'offRoad' | 'dark' | 'scheduled' | 'deviceHealth';

export interface DeiComponent {
  readonly key: DeiComponentKey;
  /** The depot's own rate, 0 to 1; null when its denominator is zero. */
  readonly value: number | null;
  readonly peerMedian: number | null;
  /** Robust z against the peer group, signed so that higher is better. */
  readonly z: number | null;
  /** Weighted contribution to the index, in z units. Zero when unranked. */
  readonly contribution: number;
}

/**
 * The rolling window an index, its peer medians and the peer-comparison depot
 * exceptions were computed over. Every time is the feed's own clock.
 */
export interface ScoreWindow {
  /** The configured length of the window, in minutes. */
  readonly lengthMin: number;
  /** Feed time of the oldest sample used; null when no sample carries a feed time. */
  readonly since: string | null;
  /** Snapshots summed. One means the figure is from a single snapshot. */
  readonly samples: number;
  /**
   * Whole minutes of feed time the samples actually span (first to last); 0
   * for one sample. A screen says "over the last N minutes" from this, never
   * from `lengthMin`. Always set by the live analysis.
   */
  readonly coveredMin?: number;
}

export type RankReason = 'ok' | 'not_a_depot' | 'fleet_too_small';

export interface DepotScore {
  readonly depotId: string;
  /** Null when the depot is not rankable. */
  readonly peerGroup: PeerGroupId | null;
  readonly ranked: boolean;
  readonly reason: RankReason;
  /** 0 to 100, one decimal; null when not ranked. */
  readonly index: number | null;
  /** 1-based within the peer group; null when not ranked. */
  readonly rank: number | null;
  readonly peerCount: number | null;
  /** Raw values are always present; z and contribution only when ranked. */
  readonly components: readonly DeiComponent[];
  /** The window the component values were summed over. Always set by the live analysis. */
  readonly window?: ScoreWindow;
  /**
   * Snapshots this depot's values were summed over (its own `window.samples`),
   * so a depot new to the window (1) can be told from peers scored on many.
   * Always set by the live analysis.
   */
  readonly samples?: number;
}
