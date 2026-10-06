import { formatCount } from '../format';
import type { ModelledDaySummary } from '../sim/operatingDayTypes';
import { noDutiesReason } from '../sim/operatingDayWording';
import type { FuelGroupRow, FuelTotals } from './types';
import { TENTH } from '@/lib/depot/units';

/*
 * Every sentence and grouping the fuel page shows is built here, so the wording
 * is asserted in tests and the components only place it. A variance is stated
 * against a vehicle or a route, never a person, and never with a cause.
 */

const DASH = '—';
const NO_ROUTE = 'No route';
const CLASS_LABELS: Readonly<Record<string, string>> = {
  ordinary: 'Ordinary',
  express: 'Express',
  ac: 'AC',
  premium: 'Premium',
};

const tenths = (value: number): number => Math.round(value * TENTH);

/** A figure to one decimal with Indian grouping of the whole part. */
export function formatTenths(value: number): string {
  const t = tenths(value);
  const frac = Math.abs(t) % TENTH;
  return `${formatCount(Math.trunc(t / TENTH))}${frac === 0 ? '' : `.${frac}`}`;
}

export function formatKmPerLitre(value: number | null): string {
  return value === null ? DASH : (tenths(value) / TENTH).toFixed(1);
}

export function formatCostPerKm(value: number | null): string {
  return value === null ? DASH : `₹${value.toFixed(2)}`;
}

export const formatKm = (km: number): string => `${formatTenths(km)} km`;
export const formatLitres = (litres: number): string => `${formatTenths(litres)} L`;

/** A route name or class key as the page words it; a null key is a bus with no route. */
export function groupLabel(key: string | null): string {
  if (key === null) return NO_ROUTE;
  return CLASS_LABELS[key] ?? key;
}

/** A route name as the page words it; a null key is a bus with no route. Not a class label. */
export function routeLabel(key: string | null): string {
  return key === null ? NO_ROUTE : key;
}

export interface RouteRow extends FuelGroupRow {
  readonly label: string;
  /** Stable and unique per group: never the label, which two groups can share. */
  readonly rowKey: string;
}

const NO_ROUTE_KEY = '\u0000no-route';
const OTHER_ROUTES_KEY = '\u0000other-routes';
const NO_DISTANCE = 'No distance';

/** The listed routes, then one row summing every route beyond the cap. */
export function routeRows(
  rows: readonly FuelGroupRow[],
  other: { readonly routeCount: number; readonly totals: FuelTotals } | null = null,
): readonly RouteRow[] {
  const listed = rows.map((row) => ({
    ...row,
    label: routeLabel(row.key),
    rowKey: row.key === null ? NO_ROUTE_KEY : `route:${row.key}`,
  }));
  if (other === null) return listed;
  return [
    ...listed,
    {
      ...other.totals,
      key: null,
      label: `Other routes (${formatCount(other.routeCount)})`,
      rowKey: OTHER_ROUTES_KEY,
    },
  ];
}

export type RouteField = 'distance' | 'litres' | 'cost' | 'kmpl' | 'cpk';

/**
 * One cell of the route table. A group with no distance has no distance, no
 * rate and no cost per km, so those read "No distance"; litres and cost show
 * only when there is something to show, never as zeros.
 */
export function routeCell(row: FuelGroupRow, field: RouteField): string {
  const noDistance = row.distanceKm <= 0;
  const nothing = noDistance && row.fuelLitres <= 0 && row.cost <= 0;
  // Bare figures: the unit is in the column header.
  switch (field) {
    case 'distance':
      return noDistance ? NO_DISTANCE : formatTenths(row.distanceKm);
    case 'kmpl':
      return noDistance ? NO_DISTANCE : formatKmPerLitre(row.kmPerLitre);
    case 'cpk':
      return noDistance || row.costPerKm === null ? NO_DISTANCE : row.costPerKm.toFixed(2);
    case 'litres':
      return nothing ? NO_DISTANCE : formatTenths(row.fuelLitres);
    case 'cost':
      return nothing ? NO_DISTANCE : formatCount(Math.round(row.cost));
  }
}

/** Cost is a sum of per-bus rounded rupees, so it need not equal litres times the price. */
export const COST_NOTE =
  'Fuel cost is summed from each bus’s fuel cost, each to the nearest rupee.';

/** The flagging rule in one sentence, from the module's own constants. */
export function ruleSentence(thresholdPct: number, minPeers: number): string {
  return (
    `A bus is listed only when it uses more than ${thresholdPct}% more fuel per kilometre than the ` +
    `median of its peers (the other buses of its class on its route, or of its class in the ` +
    `depot when the route has too few) and at least ${minPeers} of those peers lie within ` +
    `${thresholdPct}% of that median. A bus with fewer than ${minPeers} peers has no comparison.`
  );
}

/** Buses above the threshold that are not listed because their peers disagree. */
export function peersDifferNote(count: number, thresholdPct: number): string | null {
  if (count <= 0) return null;
  const one = count === 1;
  return (
    `${one ? '1 bus is' : `${formatCount(count)} buses are`} above the ${thresholdPct}% ` +
    `threshold but ${one ? 'is' : 'are'} not listed, because ${one ? 'its' : 'their'} peers ` +
    'differ too much to give a reliable median.'
  );
}

/** Buses with distance but too few similar buses to compare. */
export function noComparisonNote(count: number): string | null {
  if (count <= 0) return null;
  return count === 1
    ? '1 bus has too few similar buses to compare and is not listed.'
    : `${formatCount(count)} buses have too few similar buses to compare and are not listed.`;
}

export interface UnlistedCounts {
  readonly peersDiffer: number;
  readonly noComparison: number;
  readonly thresholdPct: number;
}

export function noDistanceNote(count: number): string | null {
  if (count <= 0) return null;
  return count === 1
    ? '1 bus has no distance in the modelled day and is not compared.'
    : `${formatCount(count)} buses have no distance in the modelled day and are not compared.`;
}

/** Buses with no duty in the modelled day are said to have none: they are in no total and have no distance. */
export function notRunNote(count: number): string | null {
  if (count <= 0) return null;
  return count === 1
    ? '1 bus has no duty in the modelled day; it has no distance and is in no figure here.'
    : `${formatCount(count)} buses have no duty in the modelled day; they have no distance and are in no figure here.`;
}

/**
 * The empty day's one sentence. With the plain date ("6 Oct 2026") it names the day, so
 * the header carries no modelled-day line of zeros (fuel C).
 */
export function emptyText(day?: ModelledDaySummary, plainDate?: string): string {
  if (!day || day.duties === 0) {
    return `${noDutiesReason(plainDate)}, so no bus runs a duty and there is no distance or fuel to show.`;
  }
  const dayName = plainDate === undefined ? 'the modelled day' : `the modelled day for ${plainDate}`;
  return `No fuel figures to show: no bus is available to run a duty in ${dayName}.`;
}

/** What is modelled, that it is not the corporation's figures, and what replaces it. */
export function modelledStatement(): string {
  return (
    'Every figure on this page is MODELLED. Each bus that runs a duty covers its route out and back in the modelled day; that distance, a lasting per-vehicle ' +
    'factor, the daily variation and the price per litre are planning assumptions, not the ' +
    'corporation’s figures. Real fuel issue records and odometer readings from the ' +
    'transport department will replace them when those feeds are connected.'
  );
}
