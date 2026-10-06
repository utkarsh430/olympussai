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
  const modelledShare = totals.modelledLengthRevenueShare;
  return [
    { key: 'trips', label: 'Trips', value: formatCount(totals.trips), caption: 'duties that ran' },
    { key: 'boardings', label: 'Boardings', value: formatCount(totals.boardings), caption: 'passengers boarding' },
    { key: 'loadFactor', label: 'Load factor', value: formatLoadFactor(totals.loadFactor), caption: 'seats filled, by trips' },
    {
      key: 'revenue',
      label: 'Revenue',
      value: formatRupees(totals.revenue),
      caption:
        modelledShare !== null && modelledShare > 0
          ? `${formatLoadFactor(modelledShare)} on modelled lengths`
          : 'for the day',
    },
    {
      key: 'earningsPerKm',
      label: 'Earnings per km',
      value: totals.earningsPerKm === null ? DASH : formatRupeesPerKmPlain(totals.earningsPerKm),
      caption: totals.earningsPerKm === null ? NO_KM_RUN : 'per kilometre run',
    },
  ];
}

export interface RevenueTableRow extends RevenueRow {
  /** 0 to 100 against the largest revenue listed; 0 when nothing earned. */
  readonly barPct: number;
  readonly lengthRounded: number;
  readonly lengthDerived: boolean;
  readonly earningsCell: string;
}

/** Every route's row with the bar geometry and the plain cells. Order is the input's. */
export function revenueTableRows(routes: readonly RouteRevenueFigure[]): readonly RevenueTableRow[] {
  const rows = buildRouteRows(routes);
  const top = Math.max(0, ...rows.map((r) => r.revenue));
  return rows.map((row, index) => ({
    ...row,
    barPct: top <= 0 ? 0 : Math.round((row.revenue / top) * FULL_BAR_PCT),
    lengthRounded: Math.round(row.lengthKm),
    lengthDerived: routes[index]?.lengthProvenance === 'derived',
    earningsCell: row.earningsPerKm === null ? DASH : formatRupeesPerKmPlain(row.earningsPerKm),
  }));
}

export const NO_ROUTES_RAN = 'No route has a bus running in the feed now, so there is no revenue to show.';

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
