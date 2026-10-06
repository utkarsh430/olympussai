import { formatCount } from '../format';
import { formatRupees } from '../fuel/format';
import type { REVENUE_MODEL_PARAMS } from '../sim/revenueConfig';
import {
  NO_KM_RUN,
  TRIPS_NOTE,
  buildRouteRows,
  formatLoadFactor,
  modelledLengthSentence,
  modelledStatement,
  type RevenueRow,
} from './revenuePageModel';
import type { ModelledDaySummary } from '../sim/operatingDayTypes';
import { NO_DUTIES_REASON } from '../sim/operatingDayWording';
import type { DepotRevenueTotals, RouteRevenueFigure } from './types';

/*
 * The revenue page's layout models: the five-figure band, the one table by
 * route with an inline revenue bar, and the closing disclosure. The page's
 * provenance line says everything is modelled; only a route length taken from a
 * real profile carries a tag (DERIVED), where it is shown.
 */

const DASH = '—';
const FULL_BAR_PCT = 100;
/** Routes shown before the pager (the list is the page's purpose). */
export const REVENUE_PAGE_ROWS = 25;

export interface RevenueBandFigure {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly caption: string;
}

/** Rupees per kilometre, two decimals, no unit: the unit is in the header or the caption. */
export function formatRupeesPerKmPlain(value: number | null): string {
  return value === null || !Number.isFinite(value) ? DASH : `₹${value.toFixed(2)}`;
}

/** Trips, boardings, load factor, revenue and earnings per kilometre, each with a short caption. */
export function revenueBand(totals: DepotRevenueTotals): readonly RevenueBandFigure[] {
  return [
    { key: 'trips', label: 'Trips', value: formatCount(totals.trips), caption: 'one per duty' },
    {
      key: 'boardings',
      label: 'Boardings',
      value: formatCount(totals.boardings),
      caption: 'passengers boarding',
    },
    {
      key: 'loadFactor',
      label: 'Load factor',
      value: formatLoadFactor(totals.loadFactor),
      caption: 'seats filled, by trips',
    },
    {
      key: 'revenue',
      label: 'Revenue',
      value: formatRupees(totals.revenue),
      caption: lengthsCaption(totals.lengthCoverage),
    },
    {
      key: 'earningsPerKm',
      label: '₹ / km',
      value: totals.earningsPerKm === null ? DASH : formatRupeesPerKmPlain(totals.earningsPerKm),
      caption: totals.earningsPerKm === null ? NO_KM_RUN : 'per kilometre run',
    },
  ];
}

/** How many route lengths come from real profiles: "route lengths modelled" when none. */
export function lengthsCaption(coverage: DepotRevenueTotals['lengthCoverage']): string {
  if (coverage.n <= 0) return 'route lengths modelled';
  return `${formatCount(coverage.n)} of ${formatCount(coverage.of)} route lengths from real profiles`;
}

/** The empty modelled day: what is absent and why, in the state panel's one sentence. */
export function noTripsSentence(day: ModelledDaySummary): string {
  return day.duties === 0
    ? `${NO_DUTIES_REASON}, so there are no trips and no revenue to show.`
    : 'No trips are modelled: no bus of this depot is free to run a duty.';
}

/** The state panel's muted line: what would bring figures to the page. */
export const NO_TRIPS_REMEDY =
  'Figures appear once a bus of this depot runs a duty in the modelled day.';

export interface RevenueTableRow extends RevenueRow {
  /** 0 to 100 against the largest revenue listed; 0 when nothing earned. */
  readonly barPct: number;
  /** The load factor as a 0 to 100 bar width; 0 when there is none. */
  readonly loadBarPct: number;
  /** Rupees, grouped, with no sign: the unit is in the header. */
  readonly revenuePlain: string;
  readonly lengthRounded: number;
  readonly lengthDerived: boolean;
  readonly earningsCell: string;
}

const loadBar = (share: number | null): number =>
  share === null || !Number.isFinite(share)
    ? 0
    : Math.round(Math.min(1, Math.max(0, share)) * FULL_BAR_PCT);

/** Every route's row with the bar geometry and the plain cells. Order is the input's. */
export function revenueTableRows(
  routes: readonly RouteRevenueFigure[],
): readonly RevenueTableRow[] {
  const rows = buildRouteRows(routes);
  const top = Math.max(0, ...rows.map((r) => r.revenue));
  return rows.map((row, index) => ({
    ...row,
    barPct: top <= 0 ? 0 : Math.round((row.revenue / top) * FULL_BAR_PCT),
    loadBarPct: loadBar(routes[index]?.loadFactor ?? null),
    revenuePlain: formatCount(Math.round(row.revenue)),
    lengthRounded: Math.round(row.lengthKm),
    lengthDerived: routes[index]?.lengthProvenance === 'derived',
    earningsCell: row.earningsPerKm === null ? DASH : row.earningsPerKm.toFixed(2),
  }));
}

export const NO_ROUTES_RAN =
  'No route has a bus running in the feed now, so there is no revenue to show.';

/** The closing disclosure: the modelled statement, the trip definition, the load-factor definition and the notes. */
export function revenueDisclosure(
  params: typeof REVENUE_MODEL_PARAMS,
  totals: DepotRevenueTotals,
  notes: readonly string[],
): readonly string[] {
  return [
    ...modelledStatement(params),
    TRIPS_NOTE,
    'Load factor is occupied seats over seats offered, weighted by trips.',
    modelledLengthSentence(totals) ?? '',
    ...notes,
  ].filter((p) => p !== '');
}
