import { tercileCuts } from '../stats/robust';
import type { DepotSummary } from '../types';
import { MIN_FLEET_FOR_RANK, MIN_PEER_GROUP } from './config';
import type { PeerGroupId } from './types';

export function isRankable(depot: DepotSummary): boolean {
  return depot.kind === 'depot' && depot.fleet >= MIN_FLEET_FOR_RANK;
}

/**
 * Fleet-size terciles of the rankable depots, so a 40-bus depot is not judged
 * against a 400-bus one. If any tercile would be thinner than MIN_PEER_GROUP
 * (including empty, as when every fleet is the same size) everyone is placed
 * in one 'all' group instead. Unrankable depots get no entry.
 */
export function assignPeerGroups(
  depots: readonly DepotSummary[],
): ReadonlyMap<string, PeerGroupId> {
  const rankable = depots.filter(isRankable);
  const cuts = tercileCuts(rankable.map((d) => d.fleet));
  if (cuts === null) return new Map();

  const [lowCut, midCut] = cuts;
  const sizeGroup = (fleet: number): PeerGroupId =>
    fleet <= lowCut ? 'small' : fleet <= midCut ? 'medium' : 'large';

  const counts: Record<PeerGroupId, number> = { small: 0, medium: 0, large: 0, all: 0 };
  for (const d of rankable) counts[sizeGroup(d.fleet)] += 1;
  const thin = counts.small < MIN_PEER_GROUP || counts.medium < MIN_PEER_GROUP ||
    counts.large < MIN_PEER_GROUP;

  return new Map(rankable.map((d) => [d.id, thin ? 'all' : sizeGroup(d.fleet)] as const));
}
