import { formatCount } from '../format';
import { formatRupees } from './format';
import type { FuelGroupRow, FuelTotals } from './types';

/*
 * Every sentence and grouping the fuel page shows is built here, so the wording
 * is asserted in tests and the components only place it. A variance is stated
 * against a vehicle or a route, never a person, and never with a cause.
 */

const DASH = '—';
const NO_ROUTE = 'No route';
const TENTH = 10;
const FULL_BAR_PCT = 100;
const CLASS_LABELS: Readonly<Record<string, string>> = {
  ordinary: 'Ordinary',
  express: 'Express',
  ac: 'AC',
  premium: 'Premium',
};

const buses = (n: number): string => (n === 1 ? '1 bus' : `${formatCount(n)} buses`);
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

export interface ClassBar {
  readonly key: string;
  readonly label: string;
  /** Share of the longest bar, 0 to 100; 0 for a class with no distance. */
  readonly widthPct: number;
  readonly valueText: string;
  readonly detail: string;
}

/** One labelled bar per class: km per litre against the best class, zero-based. */
export function classBars(rows: readonly FuelGroupRow[]): readonly ClassBar[] {
  const top = Math.max(0, ...rows.map((r) => (r.kmPerLitre === null ? 0 : tenths(r.kmPerLitre))));
  return rows.map((row) => {
    const hasValue = row.kmPerLitre !== null && row.distanceKm > 0;
    const key = row.key ?? '';
    return {
      key,
      label: groupLabel(row.key),
      widthPct:
        hasValue && top > 0 ? Math.round((tenths(row.kmPerLitre ?? 0) / top) * FULL_BAR_PCT) : 0,
      valueText: hasValue ? `${formatKmPerLitre(row.kmPerLitre)} km/L` : 'No distance',
      detail: `${buses(row.busCount)}, ${row.distanceKm > 0 ? formatKm(row.distanceKm) : 'no distance'}`,
    };
  });
}

export interface RouteRow extends FuelGroupRow {
  readonly label: string;
}

export function routeRows(rows: readonly FuelGroupRow[]): readonly RouteRow[] {
  return rows.map((row) => ({ ...row, label: groupLabel(row.key) }));
}

export interface SummaryPrice {
  readonly price: number;
  readonly defaulted: boolean;
}

/** The depot's day in one sentence. The page tags it MODELLED beside the sentence. */
export function summarySentence(totals: FuelTotals, price?: SummaryPrice): string {
  const base =
    `${buses(totals.busCount)} covered ${formatKm(totals.distanceKm)} and were issued ` +
    `${formatLitres(totals.fuelLitres)} of fuel, costing ${formatRupees(totals.cost)}.`;
  if (!price) return base;
  const unit = `${formatRupees(price.price)} per litre`;
  return `${base} Cost uses ${price.defaulted ? `the default price of ${unit}` : unit}.`;
}

/** The flagging rule in one sentence, from the module's own constants. */
export function ruleSentence(thresholdPct: number, minPeers: number): string {
  return (
    `A bus is listed when it uses more than ${thresholdPct}% more fuel per kilometre than the ` +
    `median of its peers: the other buses of its class on its route, or of its class in the ` +
    `depot when the route has too few. A bus with fewer than ${minPeers} peers has no comparison.`
  );
}

export function flaggedHeadline(total: number, shown: number): string {
  if (total === 0) return 'No bus stands out from its peers today.';
  if (total === 1) return '1 bus stands out from its peers.';
  const lead = `${formatCount(total)} buses stand out from their peers`;
  return shown < total
    ? `${lead}; the ${formatCount(shown)} with the largest variance are listed.`
    : `${lead}.`;
}

export function noDistanceNote(count: number): string | null {
  if (count <= 0) return null;
  return count === 1
    ? '1 bus has no distance today and is not compared.'
    : `${formatCount(count)} buses have no distance today and are not compared.`;
}

export function emptyText(): string {
  return (
    'No fuel figures to show: no bus has modelled distance for this date, ' +
    'because none of the depot’s buses is running or standing.'
  );
}

/** What is modelled, that it is not the corporation's figures, and what replaces it. */
export function modelledStatement(): string {
  return (
    'Every figure on this page is MODELLED. Distance for each bus, a lasting per-vehicle ' +
    'factor, the daily variation and the price per litre are planning assumptions, not the ' +
    'corporation’s figures. Real fuel issue records and odometer readings from the ' +
    'transport department will replace them when those feeds are connected.'
  );
}
