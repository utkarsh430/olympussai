import { depotHref } from '@/lib/depot/depotNav';
import { capitalise, formatCount } from '@/lib/depot/format';
import { peerRankPhrase } from '@/lib/depot/league/leagueWording';
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

/**
 * Why the suggestion is not a league table: an index is scored within a peer
 * group, so "lowest" is the lowest on the depot's own peer group's ranking, and
 * a tie goes to the smaller depot id.
 */
export const SUGGESTION_NOTE =
  'Indices are scored within peer groups, so this is the lowest within its own peer group ranking, not a like-for-like comparison across groups. A tie goes to the smaller depot id.';

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

/** The map's caption: where a unit is drawn, and which units are not drawn. */
export function mapPositionNote(missing: number): string {
  return `Each unit is drawn at the median position of its buses, not at a surveyed yard. ${unpositionedSentence(missing)}`;
}

/** The rank wording opening a line: "Rank 1 of 41 in its peer group (Small fleets)". */
export function peerRankLine(rank: number, peerCount: number, group: PeerGroupId): string {
  return capitalise(peerRankPhrase(rank, peerCount, PEER_GROUP_LABEL[group]));
}
