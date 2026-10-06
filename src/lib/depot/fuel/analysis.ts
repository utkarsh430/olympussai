import { compareText } from '@/lib/depot/stats/order';
import { median } from '../stats/robust';
import { isSupportedMedian } from './support';
import {
  DEFAULT_PRICE_PER_LITRE,
  FUEL_VARIANCE_FLAG_PCT,
  MIN_PEERS,
  type BusFuelDay,
  type BusFuelFigure,
  type FlaggedBus,
  type FuelAnalysis,
  type FuelComparisonScope,
  type FuelGroupRow,
  type FuelTotals,
} from './types';
import { TENTH } from '@/lib/depot/units';
import { roundOneDecimal } from '@/lib/depot/stats/rounding';

const PERCENT = 100;
const KEY_SEPARATOR = '\u0000';

/** Distance and litres are kept to one decimal; anything unusable counts as none. */
function usable(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value * TENTH) / TENTH : 0;
}

function figureFor(day: BusFuelDay, pricePerLitre: number): BusFuelFigure {
  const distanceKm = usable(day.distanceKm);
  const fuelLitres = usable(day.fuelLitres);
  const cost = Math.round(fuelLitres * pricePerLitre);
  const withheldReason = distanceKm === 0 ? 'no_distance' : fuelLitres === 0 ? 'no_fuel' : null;
  const measured = withheldReason === null;
  return {
    registrationNumber: day.registrationNumber,
    serviceClass: day.serviceClass,
    routeName: day.routeName,
    distanceKm,
    fuelLitres,
    cost,
    kmPerLitre: measured ? distanceKm / fuelLitres : null,
    costPerKm: measured ? cost / distanceKm : null,
    variancePct: null,
    comparison: null,
    peerMedianKmPerLitre: null,
    withheldReason,
  };
}

/** Totals sum tenths as integers so litres reconcile exactly across every grouping. */
function totalsOf(rows: readonly BusFuelFigure[]): FuelTotals {
  const distanceTenths = rows.reduce((s, r) => s + Math.round(r.distanceKm * TENTH), 0);
  const litreTenths = rows.reduce((s, r) => s + Math.round(r.fuelLitres * TENTH), 0);
  const cost = rows.reduce((s, r) => s + r.cost, 0);
  const distanceKm = distanceTenths / TENTH;
  return {
    distanceKm,
    fuelLitres: litreTenths / TENTH,
    cost,
    kmPerLitre: distanceTenths > 0 && litreTenths > 0 ? distanceTenths / litreTenths : null,
    costPerKm: distanceTenths > 0 ? cost / distanceKm : null,
    busCount: rows.length,
  };
}

/** Totals of several groups, summing tenths as integers so the parts reconcile to the whole. */
export function mergeTotals(parts: readonly FuelTotals[]): FuelTotals {
  const distanceTenths = parts.reduce((s, p) => s + Math.round(p.distanceKm * TENTH), 0);
  const litreTenths = parts.reduce((s, p) => s + Math.round(p.fuelLitres * TENTH), 0);
  const cost = parts.reduce((s, p) => s + p.cost, 0);
  const distanceKm = distanceTenths / TENTH;
  return {
    distanceKm,
    fuelLitres: litreTenths / TENTH,
    cost,
    kmPerLitre: distanceTenths > 0 && litreTenths > 0 ? distanceTenths / litreTenths : null,
    costPerKm: distanceTenths > 0 ? cost / distanceKm : null,
    busCount: parts.reduce((s, p) => s + p.busCount, 0),
  };
}

function groupRows(
  rows: readonly BusFuelFigure[],
  keyOf: (row: BusFuelFigure) => string | null,
): FuelGroupRow[] {
  const groups = new Map<string | null, BusFuelFigure[]>();
  for (const row of rows) {
    const key = keyOf(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups]
    .map(([key, members]) => ({ key, ...totalsOf(members) }))
    .sort((a, b) =>
      a.key === b.key ? 0 : a.key === null ? 1 : b.key === null ? -1 : compareText(a.key, b.key),
    );
}

interface Peer {
  readonly position: number;
  readonly kmPerLitre: number;
}

/** Comparable buses indexed by the group they belong to; a bus's peers are the others in it. */
function indexGroups(rows: readonly BusFuelFigure[]): ReadonlyMap<string, readonly Peer[]> {
  const index = new Map<string, Peer[]>();
  const add = (key: string, peer: Peer): void => {
    index.set(key, [...(index.get(key) ?? []), peer]);
  };
  rows.forEach((row, position) => {
    if (row.kmPerLitre === null) return;
    const peer = { position, kmPerLitre: row.kmPerLitre };
    add(depotKey(row), peer);
    if (row.routeName !== null) add(routeKey(row), peer);
  });
  return index;
}

const depotKey = (row: BusFuelFigure): string => `depot${KEY_SEPARATOR}${row.serviceClass}`;
const routeKey = (row: BusFuelFigure): string =>
  `route${KEY_SEPARATOR}${row.serviceClass}${KEY_SEPARATOR}${row.routeName ?? ''}`;

/** Kilometres per litre of the other buses in the group; null with too few peers. */
function peersOf(group: readonly Peer[], position: number): readonly number[] | null {
  const peers = group.filter((p) => p.position !== position).map((p) => p.kmPerLitre);
  return peers.length >= MIN_PEERS ? peers : null;
}

function compared(
  row: BusFuelFigure,
  position: number,
  index: ReadonlyMap<string, readonly Peer[]>,
): BusFuelFigure {
  if (row.kmPerLitre === null) return row;
  const candidates: readonly (readonly [FuelComparisonScope, string])[] =
    row.routeName === null
      ? [['depot', depotKey(row)]]
      : [
          ['route', routeKey(row)],
          ['depot', depotKey(row)],
        ];
  for (const [comparison, key] of candidates) {
    const peers = peersOf(index.get(key) ?? [], position);
    const centre = peers === null ? null : median(peers);
    if (peers === null || centre === null) continue;
    // More fuel per km than the peers' median is the same as fewer km per litre.
    const variancePct = roundOneDecimal((centre / row.kmPerLitre - 1) * PERCENT);
    // The figure stays; only the flag is held back when the peers do not stand behind the median.
    const unsupported = variancePct > FUEL_VARIANCE_FLAG_PCT && !isSupportedMedian(peers);
    const withheldReason = unsupported ? 'peers_differ' : null;
    return { ...row, comparison, variancePct, peerMedianKmPerLitre: centre, withheldReason };
  }
  return { ...row, withheldReason: 'no_comparison_group' };
}

function statementFor(variancePct: number, comparison: FuelComparisonScope): string {
  const shown = Number.isInteger(variancePct) ? `${variancePct}` : variancePct.toFixed(1);
  const where = comparison === 'route' ? 'on this route' : 'of its class in this depot';
  return `uses ${shown}% more fuel per kilometre than similar buses ${where}`;
}

function flagFor(row: BusFuelFigure): FlaggedBus | null {
  if (row.variancePct === null || row.comparison === null) return null;
  if (row.peerMedianKmPerLitre === null) return null;
  if (row.withheldReason !== null) return null;
  if (row.variancePct <= FUEL_VARIANCE_FLAG_PCT) return null;
  return {
    registrationNumber: row.registrationNumber,
    routeName: row.routeName,
    serviceClass: row.serviceClass,
    peerMedianKmPerLitre: row.peerMedianKmPerLitre,
    variancePct: row.variancePct,
    comparison: row.comparison,
    statement: statementFor(row.variancePct, row.comparison),
  };
}

/**
 * Consumption and cost per bus, route and class, with variance against the
 * median of its peers (the other buses of its class on its route, else in the
 * depot). Variance is a figure about a vehicle, stated without a cause. Output
 * order never depends on input order.
 *
 * A price that is missing, or not finite and positive, is replaced by
 * DEFAULT_PRICE_PER_LITRE and `priceDefaulted` is true, so a page can say so.
 */
export function analyseFuel(days: readonly BusFuelDay[], pricePerLitre?: number): FuelAnalysis {
  const supplied =
    pricePerLitre !== undefined && Number.isFinite(pricePerLitre) && pricePerLitre > 0;
  const priceDefaulted = !supplied;
  const price = supplied ? pricePerLitre : DEFAULT_PRICE_PER_LITRE;
  const base = days
    .map((day) => figureFor(day, price))
    .sort((a, b) => compareText(a.registrationNumber, b.registrationNumber));
  const index = indexGroups(base);
  const perBus = base.map((row, position) => compared(row, position, index));
  const flagged = perBus
    .map(flagFor)
    .filter((f): f is FlaggedBus => f !== null)
    .sort(
      (a, b) =>
        b.variancePct - a.variancePct || compareText(a.registrationNumber, b.registrationNumber),
    );
  return {
    pricePerLitre: price,
    priceDefaulted,
    perBus,
    perRoute: groupRows(perBus, (r) => r.routeName),
    perClass: groupRows(perBus, (r) => r.serviceClass),
    depot: totalsOf(perBus),
    flagged,
  };
}
