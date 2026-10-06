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

export function coverageSentence(coverage: Coverage): string {
  if (coverage.of === 0) return 'No routes to base it on';
  const noun = coverage.of === 1 ? 'route' : 'routes';
  return `Based on ${formatCount(coverage.n)} of ${formatCount(coverage.of)} ${noun} whose length is known`;
}

export function withheldSentence(reason: EarningsWithheldReason): string {
  return reason === 'unknown_length'
    ? 'The length is not known for this route (its stops have not been profiled), so earnings per kilometre are withheld rather than guessed. The revenue shown uses a flat fare per boarding.'
    : 'The route ran no kilometres in the model, so earnings per kilometre are withheld.';
}

/** How much of the total rests on the flat fare; null when there is nothing to say. */
export function flatFareSentence(totals: DepotRevenueTotals): string | null {
  const { flatFareRevenueShare: revenue, flatFareRouteShare: routes } = totals;
  if (revenue === null || routes === null) return null;
  return `Flat fare, length not known: ${formatLoadFactor(revenue)} of revenue, ${formatLoadFactor(routes)} of routes`;
}

export interface SummaryTile {
  readonly key: 'trips' | 'boardings' | 'loadFactor' | 'revenue' | 'earningsPerKm';
  readonly label: string;
  readonly value: string;
  readonly note: string | null;
}

export function summaryTiles(totals: DepotRevenueTotals): readonly SummaryTile[] {
  return [
    { key: 'trips', label: 'Trips', value: formatCount(totals.trips), note: null },
    { key: 'boardings', label: 'Boardings', value: formatCount(totals.boardings), note: null },
    {
      key: 'loadFactor',
      label: 'Load factor',
      value: formatLoadFactor(totals.loadFactor),
      note: 'Occupied seats over seats offered',
    },
    {
      key: 'revenue',
      label: 'Revenue',
      value: formatRupees(totals.revenue),
      note: flatFareSentence(totals),
    },
    {
      key: 'earningsPerKm',
      label: 'Earnings per km',
      value: formatRupeesPerKm(totals.earningsPerKm),
      note: coverageSentence(totals.earningsCoverage),
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
}

function lengthText(route: RouteRevenueFigure): string {
  if (route.lengthKm === null) return 'not known';
  const km = `${formatCount(Math.round(route.lengthKm))} km`;
  return route.lengthProvenance === 'derived' ? `${km} (derived)` : km;
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
      route.earningsPerKm === null ? 'length not known' : formatRupeesPerKm(route.earningsPerKm),
    withheldText: route.earningsWithheld === null ? null : withheldSentence(route.earningsWithheld),
    lengthText: lengthText(route),
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
  /** "Show all 13" or "Show top 10"; null when every route already fits. */
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
      description: `${route.routeName}: ${valueText} modelled revenue`,
    };
  });
  const capped = routes.length > HERO_CAP;
  return {
    bars,
    total: routes.length,
    toggleLabel: !capped ? null : showAll ? `Show top ${HERO_CAP}` : `Show all ${routes.length}`,
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
    `Trips come from the buses seen running each route and its scheduled duration. A trip is a run out and back, so two legs. Load factor is occupied seat-kilometres over seat-kilometres: a typical share of seats filled by service class (${loads}), moved up or down by a lasting factor of up to ${percent(params.routeSpread)} for each route and by up to ${percent(params.dailyNoise)} from day to day, and never above ${percent(params.maxLoadFactor)}.`,
    `Revenue on a leg is seats times load factor times the route length times a fare per kilometre by class (${fares}), so earnings per kilometre are seats times load factor times the fare, whatever the length. The average boarding rides ${percent(params.avgTripLengthShare)} of the route, which gives the number of boardings. Where the length is not known the model uses a flat ₹${params.flatFarePerBoarding} per boarding and earnings per kilometre are withheld. A route length taken from a real route profile is DERIVED; the earnings built on it stay MODELLED.`,
    "These are planning assumptions, not the corporation's figures. A ticketing feed and a route master with real route lengths would replace them.",
  ];
}
