import { formatCount } from '../format';
import { PEER_GROUP_LABEL } from '../labels';
import { MIN_FLEET_FOR_RANK } from '../score/config';
import type { Coverage, DepotKind } from '../types';
import type { EconomicsDepotRow } from './api';
import {
  describeDifference,
  formatComponentDifference,
  formatComponentValue,
  specOf,
  type DifferenceDirection,
} from './economicsFormat';
import type { DepotEconomicsScore, EconomicsComponentKey } from './types';

/* The economics page's rows: one per unit, with its cells, rank and reason. */

const UNRANKED_GROUP_POSITION = 4;
const PEER_GROUP_ORDER: readonly string[] = ['small', 'medium', 'large', 'all'];

export interface EconomicsCell {
  readonly key: EconomicsComponentKey;
  readonly label: string;
  readonly higherIsBetter: boolean;
  readonly value: number | null;
  readonly peerMedian: number | null;
  readonly valueText: string;
  readonly differenceText: string;
  readonly direction: DifferenceDirection;
  /** Value, difference and the word, for a title and screen-reader text. */
  readonly description: string;
  readonly coverage: Coverage | null;
  readonly z: number | null;
  readonly contribution: number;
}

export interface EconomicsRow {
  readonly depotId: string;
  readonly name: string;
  readonly kind: DepotKind;
  readonly fleet: number;
  readonly peerGroup: DepotEconomicsScore['peerGroup'];
  readonly peerGroupLabel: string | null;
  readonly ranked: boolean;
  readonly rank: number | null;
  /** The modelled index; deliberately not called `index`. */
  readonly economicsIndex: number | null;
  readonly peerCount: number | null;
  readonly reasonText: string | null;
  readonly cells: readonly EconomicsCell[];
  readonly earningsCoverage: EconomicsDepotRow['earningsCoverage'];
}

function unrankedText(entry: EconomicsDepotRow): string | null {
  const { score } = entry;
  if (score.ranked) return null;
  if (score.reason === 'not_a_depot') return 'Not an operating depot, so it is not ranked.';
  if (score.reason === 'fleet_too_small') {
    return `Needs at least ${MIN_FLEET_FOR_RANK} buses to be ranked; this depot has ${entry.fleet}.`;
  }
  if (score.reason === 'peer_group_too_small') {
    return 'Not ranked: its peer group has too few depots with complete figures to compare.';
  }
  if (score.reason === 'thin_route_coverage') {
    const { n, of } = entry.earningsCoverage;
    return `Not ranked: too few of its routes have a known length (${formatCount(n)} of ${formatCount(of)}), so its earnings per kilometre are not used.`;
  }
  if (score.missing.includes('earningsPerKm')) {
    return 'No route has a known length, so earnings per kilometre cannot be modelled for this depot.';
  }
  if (score.missing.includes('costPerKm')) {
    return 'No distance is modelled for its buses, so cost per kilometre cannot be worked out.';
  }
  return 'No seats are offered in the model, so its load factor cannot be worked out.';
}

function toCells(score: DepotEconomicsScore): EconomicsCell[] {
  return score.components.map((component) => {
    const spec = specOf(component.key);
    const delta =
      component.value === null || component.peerMedian === null
        ? null
        : component.value - component.peerMedian;
    const wording = describeDifference(component.key, delta, spec.higherIsBetter);
    const valueText = formatComponentValue(component.key, component.value);
    return {
      key: component.key,
      label: spec.label,
      higherIsBetter: spec.higherIsBetter,
      value: component.value,
      peerMedian: component.peerMedian,
      valueText,
      differenceText: formatComponentDifference(component.key, delta),
      direction: wording.direction,
      description: `${spec.label} ${valueText}, ${wording.text}`,
      coverage: component.coverage,
      z: component.z,
      contribution: component.contribution,
    };
  });
}

function groupPosition(row: EconomicsRow): number {
  return row.peerGroup === null ? UNRANKED_GROUP_POSITION : PEER_GROUP_ORDER.indexOf(row.peerGroup);
}

/** Peer group, then rank; unranked last, biggest fleet first, then name. */
function compareDefault(a: EconomicsRow, b: EconomicsRow): number {
  const byGroup = groupPosition(a) - groupPosition(b);
  if (byGroup !== 0) return byGroup;
  if (a.rank !== null && b.rank !== null) return a.rank - b.rank;
  if (a.rank !== null) return -1;
  if (b.rank !== null) return 1;
  return b.fleet - a.fleet || a.name.localeCompare(b.name, 'en');
}

export function buildEconomicsRows(depots: readonly EconomicsDepotRow[]): EconomicsRow[] {
  return depots
    .map((entry): EconomicsRow => ({
      depotId: entry.depotId,
      name: entry.name,
      kind: entry.kind,
      fleet: entry.fleet,
      peerGroup: entry.score.peerGroup,
      peerGroupLabel: entry.score.peerGroup === null ? null : PEER_GROUP_LABEL[entry.score.peerGroup],
      ranked: entry.score.ranked,
      rank: entry.score.rank,
      economicsIndex: entry.score.economicsIndex,
      peerCount: entry.score.peerCount,
      reasonText: unrankedText(entry),
      cells: toCells(entry.score),
      earningsCoverage: entry.earningsCoverage,
    }))
    .sort(compareDefault);
}

export interface EconomicsFilters {
  readonly showUnranked: boolean;
  readonly search: string;
}

export const DEFAULT_ECONOMICS_FILTERS: EconomicsFilters = { showUnranked: false, search: '' };

export function filterEconomicsRows(
  rows: readonly EconomicsRow[],
  filters: EconomicsFilters,
): EconomicsRow[] {
  const needle = filters.search.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (filters.showUnranked || row.ranked) &&
      (needle === '' || row.name.toLowerCase().includes(needle)),
  );
}
