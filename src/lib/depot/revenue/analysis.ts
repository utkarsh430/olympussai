import { compareText } from '../fuel/compare';
import type {
  DepotRevenueTotals,
  RevenueAnalysis,
  RouteRevenueFigure,
  RouteRidershipDay,
} from './types';

const TENTH = 10;
const CENT = 100;

function figureFor(day: RouteRidershipDay): RouteRevenueFigure {
  // The service kilometres are the operating day's own, so they are the fuel page's distance.
  const withheld = day.serviceKm <= 0;
  return {
    ...day,
    earningsPerKm: withheld ? null : Math.round((day.revenue / day.serviceKm) * CENT) / CENT,
    earningsWithheld: withheld ? 'no_service_km' : null,
  };
}
function sum(rows: readonly RouteRevenueFigure[], pick: (r: RouteRevenueFigure) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}

function totalsOf(rows: readonly RouteRevenueFigure[]): DepotRevenueTotals {
  const capacity = sum(rows, (r) => r.seatCapacity);
  const boardings = sum(rows, (r) => r.boardings);
  // Occupied seats, not boardings: a boarding rides only part of a leg, so
  // boardings can exceed the seats offered while the load factor cannot.
  const occupied = sum(rows, (r) => r.seatCapacity * r.loadFactor);
  const revenue = sum(rows, (r) => r.revenue);
  const modelled = rows.filter((r) => r.lengthProvenance === 'modelled');
  // Summed in whole tenths so the total never drifts from the routes' own figures.
  const serviceKm = sum(rows, (r) => Math.round(r.serviceKm * TENTH)) / TENTH;
  return {
    routes: rows.length,
    trips: sum(rows, (r) => r.trips),
    boardings,
    revenue,
    // Occupied seats over seats offered, a ratio of sums: a big route outweighs a
    // small one, as it does on the road.
    loadFactor: capacity > 0 ? occupied / capacity : null,
    serviceKm,
    // How much of the total rests on a modelled length rather than a real profile.
    modelledLengthRevenueShare: revenue > 0 ? sum(modelled, (r) => r.revenue) / revenue : null,
    earningsPerKm: serviceKm > 0 ? Math.round((revenue / serviceKm) * CENT) / CENT : null,
    lengthCoverage: { n: rows.length - modelled.length, of: rows.length },
    provenance: 'modelled',
  };
}

/**
 * Earnings per kilometre for every route that ran (under this model
 * they are seats x load factor x fare per km and do not depend on the length),
 * and depot totals. All figures MODELLED; a real length is DERIVED, a modelled
 * one says so, and `lengthCoverage` counts the real ones. Output order never
 * depends on input order.
 */
export function analyseRevenue(days: readonly RouteRidershipDay[]): RevenueAnalysis {
  const perRoute = days
    .map(figureFor)
    .sort((a, b) => compareText(a.routeName, b.routeName) || a.revenue - b.revenue);
  return { perRoute, depot: totalsOf(perRoute) };
}
