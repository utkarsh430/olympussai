import { tercileCuts } from '../stats/robust';
import type { DepotSummary } from '../types';
import { MIN_FLEET_FOR_RANK, MIN_PEER_GROUP } from './config';
import type { PeerGroupId } from './types';

export function isRankable(depot: DepotSummary): boolean {
  return depot.kind === 'depot' && depot.fleet >= MIN_FLEET_FOR_RANK;
}

/**
 * The peer group a fleet size falls in among the rankable `depots`: their
 * fleet-size terciles, so a 40-bus depot is not judged against a 400-bus one.
 * If any tercile would be thinner than MIN_PEER_GROUP (including empty, as
 * when every fleet is the same size) every size falls in one 'all' group
 * instead. Null when there are no rankable depots to group.
 */
export function peerGroupClassifier(
  depots: readonly DepotSummary[],
): ((fleet: number) => PeerGroupId) | null {
  const rankable = depots.filter(isRankable);
  const cuts = tercileCuts(rankable.map((d) => d.fleet));
  if (cuts === null) return null;

  const [lowCut, midCut] = cuts;
  const sizeGroup = (fleet: number): PeerGroupId =>
    fleet <= lowCut ? 'small' : fleet <= midCut ? 'medium' : 'large';

  const counts: Record<PeerGroupId, number> = { small: 0, medium: 0, large: 0, all: 0 };
  for (const d of rankable) counts[sizeGroup(d.fleet)] += 1;
  const thin = counts.small < MIN_PEER_GROUP || counts.medium < MIN_PEER_GROUP ||
    counts.large < MIN_PEER_GROUP;

  return thin ? () => 'all' : sizeGroup;
}

/**
 * Each rankable depot's peer group (see `peerGroupClassifier`). Unrankable
 * depots get no entry.
 */
export function assignPeerGroups(
  depots: readonly DepotSummary[],
): ReadonlyMap<string, PeerGroupId> {
  const classify = peerGroupClassifier(depots);
  if (classify === null) return new Map();
  return new Map(depots.filter(isRankable).map((d) => [d.id, classify(d.fleet)] as const));
}
