import { depotHref } from '@/lib/depot/depotNav';
import { formatCount } from '@/lib/depot/format';
import { PEER_GROUP_LABEL } from '@/lib/depot/labels';
import type { PeerGroupId } from '@/lib/depot/score/types';
import { UNASSIGNED_DEPOT_ID, type DepotSummary } from '@/lib/depot/types';
import { formatIndex, rankedIndex, unrankedReason, type DepotRow } from './overviewModel';

/** Words for the depot map, its markers and the selected-depot panel. */

function buses(n: number): string {
  return `${formatCount(n)} ${n === 1 ? 'bus' : 'buses'}`;
}

/** Accessible name of a map marker: "KAUSHAMBI, 200 buses, index 68.1". */
export function markerLabel(row: DepotRow): string {
  const index = rankedIndex(row);
  const detail =
    index === null ? `not ranked: ${unrankedReason(row)}` : `index ${formatIndex(index)}`;
  return `${row.depot.name}, ${buses(row.depot.fleet)}, ${detail}`;
}

/** Where the depot's node is drawn, or that it is not drawn at all. */
export function positionNote(depot: Pick<DepotSummary, 'positioned'>): string {
  if (depot.positioned <= 0) return 'No positioned buses; not drawn on the map';
  const noun = depot.positioned === 1 ? 'bus' : 'buses';
  return `Position: median of ${formatCount(depot.positioned)} positioned ${noun} (derived)`;
}

export const LOWEST_OPERATING_LABEL = 'Lowest index among operating depots';

/**
 * What the empty selected-depot panel offers: the ranked operating depot with
 * the lowest index (ties to the smaller id), or null when none is ranked.
 */
export function lowestOperatingDepot(rows: readonly DepotRow[]): DepotRow | null {
  let lowest: { readonly row: DepotRow; readonly index: number } | null = null;
  for (const row of rows) {
    const index = rankedIndex(row);
    if (row.depot.kind !== 'depot' || index === null) continue;
    const better =
      lowest === null ||
      index < lowest.index ||
      (index === lowest.index && row.depot.id < lowest.row.depot.id);
    if (better) lowest = { row, index };
  }
  return lowest?.row ?? null;
}

/**
 * The depot scope for a unit; null for the unassigned bucket, which is not a
 * place anyone runs.
 */
export function depotLink(depot: Pick<DepotSummary, 'id' | 'kind'>): string | null {
  if (depot.kind === 'unassigned' || depot.id === UNASSIGNED_DEPOT_ID) return null;
  return depotHref(depot.id);
}

/** The map's footnote on units without a node. */
export function unpositionedSentence(missing: number): string {
  if (missing === 0) return 'Every unit has at least one positioned bus.';
  return missing === 1
    ? '1 unit has no positioned buses and is not on the map.'
    : `${formatCount(missing)} units have no positioned buses and are not on the map.`;
}

/** "Rank 1 of 41 in its peer group (Small fleets)": 41 is the peer group, not every depot. */
export function peerRankLine(rank: number, peerCount: number, group: PeerGroupId): string {
  return `Rank ${rank} of ${peerCount} in its peer group (${PEER_GROUP_LABEL[group]})`;
}
