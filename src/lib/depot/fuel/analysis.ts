import { DEFAULT_PRICE_PER_LITRE } from '../sim/fuelConfig';
import { median } from '../stats/robust';
import {
  FUEL_VARIANCE_FLAG_PCT,
  MIN_COMPARISON_GROUP,
  type BusFuelDay,
  type BusFuelFigure,
  type FlaggedBus,
  type FuelAnalysis,
  type FuelComparisonScope,
  type FuelGroupRow,
  type FuelTotals,
} from './types';

const TENTH = 10;
const PERCENT = 100;
const KEY_SEPARATOR = '\u0000';

/** Distance and litres are kept to one decimal; anything unusable counts as none. */
function usable(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value * TENTH) / TENTH : 0;
}

function round1(value: number): number {
  return Math.round(value * TENTH) / TENTH;
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
      a.key === b.key ? 0 : a.key === null ? 1 : b.key === null ? -1 : a.key.localeCompare(b.key),
    );
}

/** Kilometres per litre of every comparable bus, indexed by the group a bus is compared in. */
function indexGroups(rows: readonly BusFuelFigure[]): ReadonlyMap<string, readonly number[]> {
  const index = new Map<string, number[]>();
  const add = (key: string, value: number): void => {
    index.set(key, [...(index.get(key) ?? []), value]);
  };
  for (const row of rows) {
    if (row.kmPerLitre === null) continue;
    add(depotKey(row), row.kmPerLitre);
    if (row.routeName !== null) add(routeKey(row), row.kmPerLitre);
  }
  return index;
}

const depotKey = (row: BusFuelFigure): string => `depot${KEY_SEPARATOR}${row.serviceClass}`;
const routeKey = (row: BusFuelFigure): string =>
  `route${KEY_SEPARATOR}${row.serviceClass}${KEY_SEPARATOR}${row.routeName ?? ''}`;

function compared(
  row: BusFuelFigure,
  index: ReadonlyMap<string, readonly number[]>,
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
    const group = index.get(key) ?? [];
    const centre = group.length >= MIN_COMPARISON_GROUP ? median(group) : null;
    if (centre === null) continue;
    // More fuel per km than the median is the same as fewer km per litre.
    return { ...row, comparison, variancePct: round1((centre / row.kmPerLitre - 1) * PERCENT) };
  }
  return { ...row, withheldReason: 'no_comparison_group' };
}

function statementFor(variancePct: number, comparison: FuelComparisonScope): string {
  const shown = Number.isInteger(variancePct) ? `${variancePct}` : variancePct.toFixed(1);
  const where = comparison === 'route' ? 'on this route' : 'in this depot';
  return `uses ${shown}% more fuel per kilometre than similar buses ${where}`;
}

function flagFor(row: BusFuelFigure): FlaggedBus | null {
  if (row.variancePct === null || row.comparison === null) return null;
  if (row.variancePct <= FUEL_VARIANCE_FLAG_PCT) return null;
  return {
    registrationNumber: row.registrationNumber,
    routeName: row.routeName,
    serviceClass: row.serviceClass,
    variancePct: row.variancePct,
    comparison: row.comparison,
    statement: statementFor(row.variancePct, row.comparison),
  };
}

/**
 * Consumption and cost per bus, route and class, with variance against the
 * median of similar buses. Variance is a figure about a vehicle, stated
 * without a cause. Output order never depends on input order.
 */
export function analyseFuel(
  days: readonly BusFuelDay[],
  pricePerLitre: number = DEFAULT_PRICE_PER_LITRE,
): FuelAnalysis {
  const price = Number.isFinite(pricePerLitre) && pricePerLitre >= 0
    ? pricePerLitre
    : DEFAULT_PRICE_PER_LITRE;
  const base = days
    .map((day) => figureFor(day, price))
    .sort((a, b) => a.registrationNumber.localeCompare(b.registrationNumber));
  const index = indexGroups(base);
  const perBus = base.map((row) => compared(row, index));
  const flagged = perBus
    .map(flagFor)
    .filter((f): f is FlaggedBus => f !== null)
    .sort(
      (a, b) =>
        b.variancePct - a.variancePct || a.registrationNumber.localeCompare(b.registrationNumber),
    );
  return {
    pricePerLitre: price,
    perBus,
    perRoute: groupRows(perBus, (r) => r.routeName),
    perClass: groupRows(perBus, (r) => r.serviceClass),
    depot: totalsOf(perBus),
    flagged,
  };
}
