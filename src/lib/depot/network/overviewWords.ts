import { formatCount, formatShare } from '@/lib/depot/format';
import { METRIC_LABEL } from '@/lib/depot/forecast/wording';
import { MIN_FLEET_FOR_RANK } from '@/lib/depot/score/config';
import type { DepotSummary, NetworkKpis, Provenance } from '@/lib/depot/types';
import type { UnrankedSummary } from './overviewModel';
import type { KindFilter } from './unitsTable';

/**
 * Words and layout for the overview's figures and table. The four state figures are
 * the classified states (`On road`, `Standing`, `Dark`, `Off road`), read from the
 * kpis by their field names; the server sums them from `classifyBusState`. A **unit** is any
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
  /**
   * One band of five: the fleet and the four classified states that partition it, so the
   * four add up to the first. Five fill the band's row at 1440, 1280 and 1024 with no
   * empty cell; reporting and route assigned are shares of the fleet and ride as its
   * caption.
   */
  readonly figures: readonly KpiFigure[];
  /** The units count, said on the units map's label: "143 units, 119 of them operating depots". */
  readonly unitsLine: string;
}

type KpiSpec = { readonly key: keyof NetworkKpis; readonly label: string };

const BAND: readonly KpiSpec[] = [
  { key: 'fleet', label: 'Fleet' },
  { key: 'onRoad', label: 'On road' },
  { key: 'stationary', label: 'Standing' },
  { key: 'noSignal', label: 'Dark' },
  { key: 'underMaintenance', label: 'Off road' },
];

/** "x of N" only when N is not the whole fleet; otherwise it repeats the figure. */
function partialCoverage(figure: NetworkKpis[keyof NetworkKpis], fleet: number): string {
  const coverage = figure.coverage;
  return coverage && coverage.of !== fleet
    ? ` · ${formatCount(coverage.n)} of ${formatCount(coverage.of)}`
    : '';
}

function stateFigure(spec: KpiSpec, kpis: NetworkKpis): KpiFigure {
  const figure = kpis[spec.key];
  const fleet = kpis.fleet.value;
  return {
    key: spec.key,
    label: spec.label,
    value: figure.value,
    provenance: figure.provenance,
    note: `${formatShare(figure.value, fleet)} of fleet${partialCoverage(figure, fleet)}`,
    detail: figure.note ?? null,
  };
}

/** The fleet, captioned with the two shares of it that are not states. */
function fleetFigure(kpis: NetworkKpis): KpiFigure {
  const { fleet, reporting, assigned } = kpis;
  const counts =
    `${formatCount(reporting.value)} reporting${partialCoverage(reporting, fleet.value)}; ` +
    `${formatCount(assigned.value)} route assigned${partialCoverage(assigned, fleet.value)}`;
  const notes = [fleet.note, reporting.note, assigned.note].filter(
    (note): note is string => typeof note === 'string' && note.length > 0,
  );
  return {
    key: 'fleet',
    label: 'Fleet',
    value: fleet.value,
    provenance: fleet.provenance,
    // Short enough for one figure of the band of five at 1024 px (about 24 characters):
    // "heard" is the module's word for a bus that is reporting; the title has both counts.
    note:
      `${formatShare(reporting.value, fleet.value)} heard · ` +
      `${formatShare(assigned.value, fleet.value)} assigned`,
    detail: [counts, ...notes].join('. '),
  };
}

function unitsLine(units: number, depots: number): string {
  const head = `${formatCount(units)} ${units === 1 ? 'unit' : 'units'}`;
  if (units === 1) return depots === 1 ? `${head}, an operating depot` : `${head}, not an operating depot`;
  if (depots === 0) return `${head}, none of them an operating depot`;
  if (depots >= units) return `${head}, all operating depots`;
  return `${head}, ${formatCount(depots)} of them operating depots`;
}

export function kpiLayout(
  kpis: NetworkKpis,
  depots: readonly Pick<DepotSummary, 'kind'>[],
): KpiLayout {
  return {
    figures: BAND.map((spec) => (spec.key === 'fleet' ? fleetFigure(kpis) : stateFigure(spec, kpis))),
    unitsLine: unitsLine(depots.length, kpis.depots.value),
  };
}

export {
  tableColumnKeys,
  type KindFilter,
  type TableColumnKey,
} from './unitsTable';
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

/**
 * "All units": the kind filter names the table. No count: the pager under the table is the
 * only place the list's count appears.
 */
export function tableHeading(filter: KindFilter): string {
  return HEADING[filter];
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

/**
 * A figure's own tag only when its provenance differs from the page's DERIVED default:
 * live and derived figures are said once by the provenance line and the feed chip.
 */
export function figureTag(provenance: Provenance): Provenance | undefined {
  return provenance === 'live' || provenance === 'derived' ? undefined : provenance;
}

const lowerFirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);

/**
 * The band's right-hand note: the week's MODELLED trends of two shares, each named,
 * because neither is a count in the band. The tag is drawn once beside it, never in
 * the words. "On-road share steady over 7 days; dark rate up 1.2 percentage points
 * over 7 days."
 */
export function weekTrendNote(onRoadWeek: string | null, darkWeek: string | null): string | null {
  const parts = [
    onRoadWeek === null ? null : `${METRIC_LABEL.onRoadShare} ${onRoadWeek}`,
    darkWeek === null ? null : `${METRIC_LABEL.darkRate} ${darkWeek}`,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return null;
  const [first, ...rest] = parts;
  return `${[first, ...rest.map(lowerFirst)].join('; ')}.`;
}
