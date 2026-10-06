/**
 * Depot Efficiency Index types.
 *
 * The index compares a depot with peers of similar fleet size on one snapshot
 * of the live feed. It scores depots, never individuals.
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
}
