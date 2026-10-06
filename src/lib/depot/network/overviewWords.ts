import { formatCount, formatShare } from '@/lib/depot/format';
import { MIN_FLEET_FOR_RANK } from '@/lib/depot/score/config';
import type { DepotSummary, NetworkKpis, Provenance } from '@/lib/depot/types';
import type { UnrankedSummary } from './overviewModel';

/**
 * Words and layout for the overview's figures and table. A **unit** is any
 * home-depot value in the feed; an **operating depot** is a unit of kind
 * `depot`; everything else is an **other unit**. Operating depots are counted
 * against units, never against buses.
 */

export interface KpiFigure {
  readonly key: keyof NetworkKpis;
  readonly label: string;
  readonly value: number;
  readonly provenance: Provenance;
  /** A quiet line under the figure: its share of the fleet, or what it is counted against. */
  readonly note: string | null;
  /** The server's own note on the figure, when it has one. */
  readonly detail: string | null;
}

export interface KpiLayout {
  readonly primary: readonly KpiFigure[];
  readonly secondary: readonly KpiFigure[];
}

type KpiSpec = { readonly key: keyof NetworkKpis; readonly label: string };

const PRIMARY: readonly KpiSpec[] = [
  { key: 'fleet', label: 'Fleet' },
  { key: 'onRoad', label: 'On road' },
  { key: 'stationary', label: 'Stationary' },
  { key: 'noSignal', label: 'No signal' },
  { key: 'depots', label: 'Operating depots' },
];

const SECONDARY: readonly KpiSpec[] = [
  { key: 'reporting', label: 'Reporting' },
  { key: 'underMaintenance', label: 'Under maintenance' },
  { key: 'assigned', label: 'Route assigned' },
];

function unitsNote(units: number): string {
  return `of ${formatCount(units)} ${units === 1 ? 'unit' : 'units'} in the feed`;
}

function figureFor(spec: KpiSpec, kpis: NetworkKpis, units: number): KpiFigure {
  const figure = kpis[spec.key];
  const fleet = kpis.fleet.value;
  let note: string | null;
  if (spec.key === 'depots') {
    note = unitsNote(units);
  } else {
    const coverage = figure.coverage;
    // "x of N" only when N is not the whole fleet; otherwise it repeats the figure.
    const partial =
      coverage && coverage.of !== fleet
        ? ` · ${formatCount(coverage.n)} of ${formatCount(coverage.of)}`
        : '';
    note = `${formatShare(figure.value, fleet)} of fleet${partial}`;
  }
  return {
    key: spec.key,
    label: spec.label,
    value: figure.value,
    provenance: figure.provenance,
    note,
    detail: figure.note ?? null,
  };
}

/** Four bus figures and operating depots in the band (five at most); the rest as one quiet line. */
export function kpiLayout(
  kpis: NetworkKpis,
  depots: readonly Pick<DepotSummary, 'kind'>[],
): KpiLayout {
  const units = depots.length;
  return {
    primary: PRIMARY.map((spec) => figureFor(spec, kpis, units)),
    secondary: SECONDARY.map((spec) => figureFor(spec, kpis, units)),
  };
}

export type KindFilter = 'all' | 'depot' | 'other';

export const KIND_FILTER_OPTIONS: ReadonlyArray<{
  readonly id: KindFilter;
  readonly label: string;
}> = [
  { id: 'all', label: 'All' },
  { id: 'depot', label: 'Operating depots' },
  { id: 'other', label: 'Other units' },
];

const HEADING: Readonly<Record<KindFilter, string>> = {
  all: 'All units',
  depot: 'Operating depots',
  other: 'Other units',
};

/** "All units · 143": the kind filter names the table and the count is what it shows. */
export function tableHeading(filter: KindFilter, count: number): string {
  return `${HEADING[filter]} · ${formatCount(count)}`;
}

export type TableColumnKey =
  | 'name'
  | 'kind'
  | 'fleet'
  | 'reporting'
  | 'assigned'
  | 'onRoad'
  | 'stationary'
  | 'noSignal'
  | 'maintenance'
  | 'mix'
  | 'index'
  | 'peerGroup';

const WIDE: readonly TableColumnKey[] = [
  'name',
  'kind',
  'fleet',
  'reporting',
  'assigned',
  'onRoad',
  'stationary',
  'noSignal',
  'maintenance',
  'mix',
  'index',
  'peerGroup',
];

/** Below 900px: the figures a planner compares first; the rest is in the depot's own pages. */
const NARROW: ReadonlySet<TableColumnKey> = new Set([
  'name',
  'fleet',
  'reporting',
  'assigned',
  'onRoad',
  'noSignal',
  'index',
]);

/** Kind is dropped when the filter already says every row is an operating depot. */
export function tableColumnKeys(filter: KindFilter, narrow: boolean): TableColumnKey[] {
  return WIDE.filter((key) => {
    if (narrow && !NARROW.has(key)) return false;
    return !(key === 'kind' && filter === 'depot');
  });
}

export const TABLE_ROW_CAP = 25;

/**
 * The toggle under the table: "Show all 143". The label does not flip when the table
 * opens; its state is carried by `aria-expanded`.
 */
export function tableToggleLabel(total: number): string {
  return `Show all ${formatCount(total)}`;
}

export interface TableCap {
  /** The table shows only its first rows. */
  readonly capped: boolean;
  /** Whether the toggle is worth showing: there are more rows than the cap. */
  readonly toggle: boolean;
}

export function tableCap(total: number, expanded: boolean): TableCap {
  const overCap = total > TABLE_ROW_CAP;
  return { capped: overCap && !expanded, toggle: overCap };
}

export interface SortDescription {
  readonly label: string;
  readonly direction: 'asc' | 'desc';
}

/**
 * What order the capped rows are in, said as it is: "in the default order" while
 * the table sits in its starting sort, "sorted by <column>" after a person
 * chose one.
 */
export function tableCapLine(
  shown: number,
  total: number,
  sort: SortDescription | null,
  isDefault: boolean,
): string {
  const head = `Showing the first ${formatCount(shown)} of ${formatCount(total)}`;
  if (isDefault || !sort) return `${head} in the default order`;
  const way = sort.direction === 'asc' ? 'ascending' : 'descending';
  return `${head}, sorted by ${sort.label} (${way})`;
}

function counted(n: number, one: string, many: string): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

/** "25 units are not ranked: 1 operating depot with fewer than 10 buses, 24 other units." */
export function unrankedSentence(summary: UnrankedSummary): string {
  const parts = [
    summary.fleetTooSmall > 0
      ? `${counted(summary.fleetTooSmall, 'operating depot', 'operating depots')} with fewer than ${MIN_FLEET_FOR_RANK} buses`
      : null,
    summary.notADepot > 0 ? counted(summary.notADepot, 'other unit', 'other units') : null,
    summary.unscored > 0 ? `${formatCount(summary.unscored)} without a score` : null,
  ].filter((part): part is string => part !== null);
  const verb = summary.total === 1 ? 'is' : 'are';
  return `${counted(summary.total, 'unit', 'units')} ${verb} not ranked: ${parts.join(', ')}.`;
}

/** "Reporting 2,853 (29% of fleet)": a secondary figure as one reading of the quiet line. */
export function secondaryReading(figure: KpiFigure): string {
  return `${figure.label} ${formatCount(figure.value)}${figure.note ? ` (${figure.note})` : ''}`;
}

/**
 * A figure's own tag only when its provenance differs from the page's DERIVED default:
 * live and derived figures are said once by the provenance line and the feed chip.
 */
export function figureTag(provenance: Provenance): Provenance | undefined {
  return provenance === 'live' || provenance === 'derived' ? undefined : provenance;
}
