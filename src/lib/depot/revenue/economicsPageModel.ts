import { PEER_GROUP_LABEL } from '../labels';
import { MIN_FLEET_FOR_RANK } from '../score/config';
import type { ECONOMICS_WEIGHTS } from '../sim/revenueConfig';
import type { DepotKind } from '../types';
import { formatCount } from '../format';
import type { EconomicsDepotRow } from './api';
import type { DepotEconomicsScore, EconomicsComponentKey, EconomicsRankReason } from './types';
import type { Coverage } from '../types';

/*
 * The network economics page's rows, sentences and breakdown. This is the
 * MODELLED Depot Economics Index; nothing here reads or names a value of the
 * Depot Efficiency Index.
 */

const DASH = '—';
const MINUS = '−';
const PERCENT = 100;
const TENTH = 10;
const HUNDREDTH = 100;
const UNRANKED_GROUP_POSITION = 4;
const PEER_GROUP_ORDER: readonly string[] = ['small', 'medium', 'large', 'all'];

interface ComponentSpec {
  readonly key: EconomicsComponentKey;
  readonly label: string;
  readonly higherIsBetter: boolean;
  readonly unit: 'rupees' | 'share';
}

export const ECONOMICS_COMPONENT_SPECS: readonly ComponentSpec[] = [
  { key: 'earningsPerKm', label: 'Earnings per km', higherIsBetter: true, unit: 'rupees' },
  { key: 'costPerKm', label: 'Cost per km', higherIsBetter: false, unit: 'rupees' },
  { key: 'loadFactor', label: 'Load factor', higherIsBetter: true, unit: 'share' },
];

const specOf = (key: EconomicsComponentKey): ComponentSpec =>
  ECONOMICS_COMPONENT_SPECS.find((s) => s.key === key) as ComponentSpec;

const roundTo = (n: number, scale: number): number => Math.round(n * scale) / scale;

function rupees(value: number): string {
  return `₹${value.toFixed(2)} per km`;
}

function pointsText(ratio: number): string {
  return roundTo(ratio * PERCENT, TENTH).toFixed(1);
}

export function formatComponentValue(key: EconomicsComponentKey, value: number | null): string {
  if (value === null || !Number.isFinite(value)) return DASH;
  return specOf(key).unit === 'rupees' ? rupees(value) : `${pointsText(value)}%`;
}

/** The raw sign of value minus peer median, in the component's own unit. */
export function formatComponentDifference(key: EconomicsComponentKey, delta: number | null): string {
  if (delta === null || !Number.isFinite(delta)) return DASH;
  if (specOf(key).unit === 'rupees') {
    const rounded = roundTo(delta, HUNDREDTH);
    return rounded === 0 ? rupees(0) : `${rounded > 0 ? '+' : MINUS}${rupees(Math.abs(rounded))}`;
  }
  const rounded = roundTo(delta * PERCENT, TENTH);
  return rounded === 0 ? '0.0 pp' : `${rounded > 0 ? '+' : MINUS}${Math.abs(rounded).toFixed(1)} pp`;
}

export type DifferenceDirection = 'better' | 'worse' | 'level' | 'unknown';

export interface DifferenceWording {
  readonly text: string;
  readonly direction: DifferenceDirection;
}

/** The word comes from whether higher is better; the sign alone never carries the meaning. */
export function describeDifference(
  key: EconomicsComponentKey,
  delta: number | null,
  higherIsBetter: boolean,
): DifferenceWording {
  if (delta === null || !Number.isFinite(delta)) return { text: 'no peer median', direction: 'unknown' };
  const rupeeUnit = specOf(key).unit === 'rupees';
  const rounded = rupeeUnit ? roundTo(delta, HUNDREDTH) : roundTo(delta * PERCENT, TENTH);
  if (rounded === 0) return { text: 'level with peers', direction: 'level' };
  const good = rounded > 0 === higherIsBetter;
  const size = rupeeUnit ? rupees(Math.abs(rounded)) : `${Math.abs(rounded).toFixed(1)} pp`;
  return {
    text: `${size} ${good ? 'better' : 'worse'} than peers`,
    direction: good ? 'better' : 'worse',
  };
}

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

const SEP = ' · ';

function count(depots: readonly EconomicsDepotRow[], reason: EconomicsRankReason): number {
  return depots.filter((d) => d.score.reason === reason).length;
}

/** "4 ranked of 6 operating depots (MODELLED) · 1 not ranked: no route with a known length". */
export function economicsStatusLine(depots: readonly EconomicsDepotRow[]): string {
  const operating = depots.filter((d) => d.kind === 'depot');
  const ranked = operating.filter((d) => d.score.ranked).length;
  const noLength = operating.filter(
    (d) => d.score.reason === 'missing_component' && d.score.missing.includes('earningsPerKm'),
  ).length;
  const tooSmall = operating.filter((d) => d.score.reason === 'fleet_too_small').length;
  const thin = count(operating, 'thin_route_coverage');
  const smallGroup = count(operating, 'peer_group_too_small');
  const otherMissing = operating.filter((d) => d.score.reason === 'missing_component').length - noLength;
  const others = depots.length - operating.length;
  const noun = operating.length === 1 ? 'operating depot' : 'operating depots';
  const parts = [
    `${formatCount(ranked)} ranked of ${formatCount(operating.length)} ${noun} (MODELLED)`,
    noLength > 0 ? `${formatCount(noLength)} not ranked: no route with a known length` : null,
    thin > 0 ? `${formatCount(thin)} not ranked: too few routes with a known length` : null,
    smallGroup > 0
      ? `${formatCount(smallGroup)} not ranked: its peer group has too few depots with complete figures`
      : null,
    tooSmall > 0 ? `${formatCount(tooSmall)} not ranked: fewer than ${MIN_FLEET_FOR_RANK} buses` : null,
    otherMissing > 0 ? `${formatCount(otherMissing)} not ranked: a component could not be worked out` : null,
    others > 0
      ? `${formatCount(others)} other ${others === 1 ? 'unit is not an operating depot' : 'units are not operating depots'}`
      : null,
  ];
  return parts.filter((p): p is string => p !== null).join(SEP);
}

/** "rank 1 of 6 in its peer group (All depots)". */
export function peerRankPhrase(row: EconomicsRow): string {
  if (!row.ranked || row.rank === null || row.peerCount === null || row.peerGroupLabel === null) {
    return 'not ranked';
  }
  return `rank ${row.rank} of ${row.peerCount} in its peer group (${row.peerGroupLabel})`;
}

/** One sentence on what moved a depot's economics index most. */
export function explainEconomics(row: EconomicsRow): string {
  if (row.reasonText !== null) return row.reasonText;
  const scored = row.cells.filter((c) => c.value !== null);
  const rounded = (c: EconomicsCell): number => roundTo(c.contribution, HUNDREDTH);
  const [first, ...rest] = scored;
  if (first === undefined) return 'No component could be worked out for this depot.';
  const strongest = rest.reduce((a, b) => (rounded(b) > rounded(a) ? b : a), first);
  const weakest = rest.reduce((a, b) => (rounded(b) < rounded(a) ? b : a), first);
  if (rounded(strongest) === rounded(weakest)) {
    return 'No single measure stands out; every component contributes equally.';
  }
  return `Helped most by ${strongest.label}; held back most by ${weakest.label}.`;
}

export interface BreakdownRow {
  readonly key: EconomicsComponentKey;
  readonly label: string;
  readonly valueText: string;
  readonly peerMedianText: string;
  /** "2 of 8 routes" for earnings per km; null for the other components. */
  readonly coverageText: string | null;
  readonly zText: string;
  readonly weightText: string;
  readonly contributionText: string;
}

function signed(n: number): string {
  const rounded = roundTo(n, HUNDREDTH);
  if (rounded === 0) return '0.00';
  return `${rounded > 0 ? '+' : MINUS}${Math.abs(rounded).toFixed(2)}`;
}

export function breakdownRows(
  row: EconomicsRow,
  weights: typeof ECONOMICS_WEIGHTS,
): BreakdownRow[] {
  return row.cells.map((cell) => ({
    key: cell.key,
    label: cell.label,
    valueText: cell.valueText,
    peerMedianText: formatComponentValue(cell.key, cell.peerMedian),
    coverageText:
      cell.coverage === null
        ? null
        : `${formatCount(cell.coverage.n)} of ${formatCount(cell.coverage.of)} routes`,
    zText: cell.z === null ? DASH : signed(cell.z),
    weightText: `${Math.round(weights[cell.key] * PERCENT)}%`,
    contributionText: row.ranked ? signed(cell.contribution) : DASH,
  }));
}

/** The one sentence that keeps the two indices apart; the link goes between lead and tail. */
export const INDEX_SEPARATION = {
  lead: 'The Depot Economics Index is MODELLED from planning assumptions and is separate from the Depot Efficiency Index, which is built from live data. The efficiency index is on the ',
  linkText: 'league table',
  tail: '.',
} as const;

/** The footnote under a breakdown: how contributions become the index. */
export const BREAKDOWN_NOTE =
  'Each component is compared with the peer median, signed so higher is better (lower cost counts as better). The weighted contributions are summed and scaled so a typical peer sits at 50: a total of +3 reaches 100 and −3 reaches 0.';
