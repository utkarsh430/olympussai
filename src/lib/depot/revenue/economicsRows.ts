import { PEER_GROUP_LABEL } from '../labels';
import { MIN_FLEET_FOR_RANK } from '../score/config';
import type { Coverage, DepotKind } from '../types';
import type { EconomicsDepotRow } from './api';
import {
  bareComponentDifference,
  bareComponentValue,
  describeDifference,
  formatComponentDifference,
  formatComponentValue,
  specOf,
  type DifferenceDirection,
} from './economicsFormat';
import { noDutyPhrase } from './economicsLayout';
import { coverageSentence, NO_KM_RUN } from './revenuePageModel';
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
  /** The table cell: a bare number (unit in the header) and the signed change as a muted suffix. */
  readonly bareValue: string;
  readonly bareDifference: string;
  readonly direction: DifferenceDirection;
  /** Value, difference and the word, for a title and screen-reader text. */
  readonly description: string;
  /** Beside earnings per km: how many of the routes' lengths are real; null on the others. */
  readonly noteText: string | null;
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
  /** The reason in a few words, shown under "not ranked" in the grid; null when ranked. */
  readonly reasonShort: string | null;
  readonly cells: readonly EconomicsCell[];
  readonly lengthCoverage: EconomicsDepotRow['lengthCoverage'];
}

function unrankedShort(entry: EconomicsDepotRow): string | null {
  const { score } = entry;
  if (score.ranked) return null;
  if (score.reason === 'not_a_depot') return 'not an operating depot';
  if (score.reason === 'fleet_too_small') return `fewer than ${MIN_FLEET_FOR_RANK} buses`;
  if (score.reason === 'peer_group_too_small') return 'peer group too small';
  if (score.missing.includes('earningsPerKm')) return NO_KM_RUN;
  return 'a component could not be worked out';
}

function unrankedText(entry: EconomicsDepotRow, operatingDate?: string): string | null {
  const { score } = entry;
  if (score.ranked) return null;
  if (score.reason === 'not_a_depot') return 'Not an operating depot, so it is not ranked.';
  if (score.reason === 'fleet_too_small') {
    return `Needs at least ${MIN_FLEET_FOR_RANK} buses to be ranked; this depot has ${entry.fleet}.`;
  }
  if (score.reason === 'peer_group_too_small') {
    return 'Not ranked: its peer group has too few depots with complete figures to compare.';
  }
  if (score.missing.includes('earningsPerKm')) {
    const phrase = noDutyPhrase(operatingDate);
    return `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)} (none of its buses reports a route, or none is available), so it has no earnings per kilometre.`;
  }
  if (score.missing.includes('costPerKm')) {
    return `No bus runs a duty in the modelled day${operatingDate === undefined ? '' : ` for ${operatingDate}`}, so fuel cost per kilometre cannot be worked out.`;
  }
  return 'No seats are offered in the model, so its load factor cannot be worked out.';
}

const NOT_WORKED_OUT = 'not worked out';
const NO_PEER_MEDIAN_REASON: DepotEconomicsScore['reason'] = 'peer_group_too_small';

/** The earnings cell always says what its lengths rest on: a coverage figure, never a gate. */
function earningsNote(entry: EconomicsDepotRow): string {
  return coverageSentence(entry.lengthCoverage).toLowerCase();
}
function missingText(key: EconomicsComponentKey): string {
  return key === 'earningsPerKm' ? NO_KM_RUN : NOT_WORKED_OUT;
}

function toCells(entry: EconomicsDepotRow): EconomicsCell[] {
  const { score } = entry;
  return score.components.map((component) => {
    const spec = specOf(component.key);
    // A peer group too small to compare has no median worth showing or comparing to.
    const peerMedian = score.reason === NO_PEER_MEDIAN_REASON ? null : component.peerMedian;
    const delta =
      component.value === null || peerMedian === null ? null : component.value - peerMedian;
    const wording = describeDifference(component.key, delta, spec.higherIsBetter);
    const valueText =
      component.value === null ? missingText(component.key) : formatComponentValue(component.key, component.value);
    const noteText = component.key === 'earningsPerKm' ? earningsNote(entry) : null;
    const compared = wording.direction === 'unknown' ? '' : `, ${wording.text}`;
    return {
      key: component.key,
      label: spec.label,
      higherIsBetter: spec.higherIsBetter,
      value: component.value,
      peerMedian,
      valueText,
      differenceText: delta === null ? '' : formatComponentDifference(component.key, delta),
      bareValue: component.value === null ? valueText : bareComponentValue(component.key, component.value),
      bareDifference: bareComponentDifference(component.key, delta),
      direction: wording.direction,
      description: `${spec.label} ${valueText}${noteText === null ? '' : ` (${noteText})`}${compared}`,
      noteText,
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

export function buildEconomicsRows(
  depots: readonly EconomicsDepotRow[],
  operatingDate?: string,
): EconomicsRow[] {
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
      reasonText: unrankedText(entry, operatingDate),
      reasonShort: unrankedShort(entry),
      cells: toCells(entry),
      lengthCoverage: entry.lengthCoverage,
    }))
    .sort(compareDefault);
}

export interface EconomicsFilters {
  readonly showUnranked: boolean;
  readonly search: string;
}

/** Show every depot from the start when nothing is ranked, so the page is never an empty table. */
export function defaultShowUnranked(rows: readonly EconomicsRow[]): boolean {
  return rows.length > 0 && rows.every((row) => !row.ranked);
}

/** What the empty table row says: nothing is ranked yet, or the filters hide every row. */
export function emptyRowText(rows: readonly EconomicsRow[], filters: EconomicsFilters): string {
  if (!filters.showUnranked && rows.every((row) => !row.ranked)) {
    return 'Nothing is ranked yet. Turn on Show unranked to see every depot and why it is not ranked.';
  }
  return 'The filters hide every row. Clear the search or turn on Show unranked.';
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
