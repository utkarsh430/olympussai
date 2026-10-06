import { formatCount } from '../format';
import { formatRupees } from '../fuel/format';
import type { REVENUE_MODEL_PARAMS } from '../sim/revenueConfig';
import type { ServiceClass } from '../sim/types';
import type { Coverage } from '../types';
import type {
  DepotRevenueTotals,
  EarningsWithheldReason,
  RouteRevenueFigure,
} from './types';

/*
 * Every sentence, label and bar of the revenue page, built here so it is
 * tested and the components only render it. All figures are MODELLED.
 */

const DASH = '—';
const PERCENT = 100;
const TENTH = 10;
export const HERO_CAP = 10;

export const SERVICE_CLASS_LABEL: Readonly<Record<ServiceClass, string>> = {
  ordinary: 'Ordinary',
  express: 'Express',
  ac: 'AC',
  premium: 'Premium',
};

const CLASS_ORDER: readonly ServiceClass[] = ['ordinary', 'express', 'ac', 'premium'];

/** Rupees per kilometre, two decimals. */
export function formatRupeesPerKm(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return DASH;
  return `₹${value.toFixed(2)} per km`;
}

/** A 0-to-1 ratio as a percentage with one decimal. */
export function formatLoadFactor(ratio: number | null): string {
  if (ratio === null || !Number.isFinite(ratio)) return DASH;
  return `${(Math.round(ratio * PERCENT * TENTH) / TENTH).toFixed(1)}%`;
}

/** Trips here are the day's; the Routes page counts turn-rounds of the buses seen on a route now. */
export const TRIPS_NOTE = 'Duties that ran in the modelled day, one trip out and back each';

/** "Lengths: 3 of 14 routes from real route profiles, the rest modelled": a coverage figure, never a gate. */
export function coverageSentence(coverage: Coverage): string {
  if (coverage.of === 0) return 'No routes ran in the modelled day';
  const noun = coverage.of === 1 ? 'route' : 'routes';
  const rest = coverage.n >= coverage.of ? '' : ', the rest modelled';
  return `Lengths: ${formatCount(coverage.n)} of ${formatCount(coverage.of)} ${noun} from real route profiles${rest}`;
}

/** Shown for earnings per km when nothing ran, so there are no kilometres to divide by. */
export const NO_KM_RUN = 'no kilometres run';

/** A column header that tags its figures MODELLED. */
export function modelledHeader(label: string): string {
  return `${label} (MODELLED)`;
}

/** The route length column: each cell says whether its length is DERIVED (a real profile) or MODELLED. */
export const DERIVED_LENGTH_HEADER = 'Route length';

const WITHHELD_SENTENCE: Readonly<Record<EarningsWithheldReason, string>> = {
  no_service_km:
    'No duty on this route had a bus in the modelled day, so it ran no kilometres and has no earnings per kilometre.',
};

export function withheldSentence(reason: EarningsWithheldReason): string {
  return WITHHELD_SENTENCE[reason];
}

/** How much of the revenue rests on a modelled route length; null when there is nothing to say. */
export function modelledLengthSentence(totals: DepotRevenueTotals): string | null {
  const share = totals.modelledLengthRevenueShare;
  if (share === null || share <= 0) return null;
  return `${formatLoadFactor(share)} of revenue is on routes of modelled length (no real profile yet)`;
}

export interface SummaryTile {
  readonly key: 'trips' | 'boardings' | 'loadFactor' | 'revenue' | 'earningsPerKm';
  readonly label: string;
  readonly value: string;
  readonly note: string | null;
}

export function summaryTiles(totals: DepotRevenueTotals): readonly SummaryTile[] {
  return [
    { key: 'trips', label: 'Trips', value: formatCount(totals.trips), note: TRIPS_NOTE },
    { key: 'boardings', label: 'Boardings', value: formatCount(totals.boardings), note: null },
    {
      key: 'loadFactor',
      label: 'Load factor',
      value: formatLoadFactor(totals.loadFactor),
      note: 'Occupied seats over seats offered, weighted by trips',
    },
    {
      key: 'revenue',
      label: 'Revenue',
      value: formatRupees(totals.revenue),
      note: modelledLengthSentence(totals),
    },
    {
      key: 'earningsPerKm',
      label: 'Earnings per km',
      value: totals.earningsPerKm === null ? NO_KM_RUN : formatRupeesPerKm(totals.earningsPerKm),
      note: coverageSentence(totals.lengthCoverage),
    },
  ];
}

export interface RevenueRow {
  readonly routeName: string;
  readonly classLabel: string;
  readonly trips: number;
  readonly boardings: number;
  readonly loadFactor: number;
  readonly loadFactorText: string;
  readonly revenue: number;
  readonly revenueText: string;
  readonly earningsPerKm: number | null;
  readonly earningsText: string;
  /** The reason, in a sentence; null when earnings are shown. */
  readonly withheldText: string | null;
  readonly lengthText: string;
  /** The length in kilometres, for sorting. */
  readonly lengthKm: number;
}

function lengthText(route: RouteRevenueFigure): string {
  const km = `${formatCount(Math.round(route.lengthKm))} km`;
  return route.lengthProvenance === 'derived' ? `${km} (derived)` : `${km} (modelled)`;
}

export function buildRouteRows(routes: readonly RouteRevenueFigure[]): RevenueRow[] {
  return routes.map((route) => ({
    routeName: route.routeName,
    classLabel: SERVICE_CLASS_LABEL[route.serviceClass],
    trips: route.trips,
    boardings: route.boardings,
    loadFactor: route.loadFactor,
    loadFactorText: formatLoadFactor(route.loadFactor),
    revenue: route.revenue,
    revenueText: formatRupees(route.revenue),
    earningsPerKm: route.earningsPerKm,
    earningsText:
      route.earningsPerKm === null ? NO_KM_RUN : formatRupeesPerKm(route.earningsPerKm),
    withheldText: route.earningsWithheld === null ? null : withheldSentence(route.earningsWithheld),
    lengthText: lengthText(route),
    lengthKm: route.lengthKm,
  }));
}

export interface HeroBar {
  readonly key: string;
  readonly label: string;
  readonly valueText: string;
  /** 0 to 100, whole numbers, against the largest bar shown. */
  readonly widthPercent: number;
  /** The bar's text equivalent. */
  readonly description: string;
}

export interface Hero {
  readonly bars: readonly HeroBar[];
  readonly total: number;
  /** "Show all 13", fixed whatever is shown (aria-expanded carries the state); null when all fit. */
  readonly toggleLabel: string | null;
}

/** Revenue by route, highest first (the input order), capped unless `showAll`. */
export function heroBars(routes: readonly RouteRevenueFigure[], showAll: boolean): Hero {
  const shown = showAll ? routes : routes.slice(0, HERO_CAP);
  const largest = Math.max(0, ...shown.map((r) => r.revenue));
  const bars = shown.map((route): HeroBar => {
    const valueText = formatRupees(route.revenue);
    return {
      key: route.routeName,
      label: route.routeName,
      valueText,
      widthPercent: largest === 0 ? 0 : Math.round((route.revenue / largest) * PERCENT),
      description: `${route.routeName}: ${valueText} modelled revenue${
        route.lengthProvenance === 'modelled' ? ' (modelled route length)' : ''
      }`,
    };
  });
  const capped = routes.length > HERO_CAP;
  return {
    bars,
    total: routes.length,
    toggleLabel: capped ? `Show all ${routes.length}` : null,
  };
}

type Params = typeof REVENUE_MODEL_PARAMS;

function percent(ratio: number): string {
  return `${Math.round(ratio * PERCENT)}%`;
}

/** The MODELLED statement as paragraphs, with every parameter read from the model. */
export function modelledStatement(params: Params): readonly string[] {
  const loads = CLASS_ORDER.map((c) => `${c} ${percent(params.loadFactorBase[c])}`).join(', ');
  const fares = CLASS_ORDER.map((c) => `${c} ₹${params.farePerKm[c].toFixed(2)}`).join(', ');
  return [
    'Everything on this page is MODELLED. The live feed carries no ticketing, so trips, boardings, load factors, fares and revenue are generated by a model, not measured.',
    `Trips come from the modelled day: each duty that a bus ran is one trip, a run out and back, so two legs. (The Routes page counts something else: how often the buses seen on a route now would turn round.) For a route, load factor is the share of seats filled on a leg: a typical share by service class (${loads}), moved up or down by a lasting factor of up to ${percent(params.routeSpread)} for each route and by up to ${percent(params.dailyNoise)} from day to day, and never above ${percent(params.maxLoadFactor)}. For a depot, occupied seats over seats offered, weighted by trips, so a route with more trips counts for more.`,
    `Revenue on a leg is seats times load factor times the route length times a fare per kilometre by class (${fares}), so earnings per kilometre are seats times load factor times the fare, whatever the length. The average boarding rides ${percent(params.avgTripLengthShare)} of the route, which gives the number of boardings. A route with a real profile uses its real length (DERIVED); one without uses a typical length for its class (MODELLED), and each row says which.`,
    "These are planning assumptions, not the corporation's figures. A ticketing feed and a route master with real route lengths would replace them.",
  ];
}
