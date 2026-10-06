import { compareText } from '../fuel/compare';
import { LEGS_PER_TRIP } from '../sim/revenueConfig';
import type {
  DepotRevenueTotals,
  RevenueAnalysis,
  RouteRevenueFigure,
  RouteRidershipDay,
} from './types';

const TENTH = 10;
const CENT = 100;

function figureFor(day: RouteRidershipDay): RouteRevenueFigure {
  const { lengthKm } = day;
  if (lengthKm === null) {
    return {
      ...day,
      serviceKm: null,
      earningsPerKm: null,
      earningsWithheld: 'unknown_length',
      lengthProvenance: null,
    };
  }
  // A trip starts and ends at the depot, so it covers the route length out and back.
  const serviceKm = Math.round(day.trips * lengthKm * LEGS_PER_TRIP * TENTH) / TENTH;
  const withheld = serviceKm <= 0;
  return {
    ...day,
    serviceKm,
    earningsPerKm: withheld ? null : Math.round((day.revenue / serviceKm) * CENT) / CENT,
    earningsWithheld: withheld ? 'no_service_km' : null,
    lengthProvenance: 'derived',
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
  const flat = rows.filter((r) => r.revenueBasis === 'flat_fare_unknown_length');
  const priced = rows.filter((r) => r.serviceKm !== null && r.serviceKm > 0);
  const serviceKm = sum(priced, (r) => r.serviceKm ?? 0);
  return {
    routes: rows.length,
    trips: sum(rows, (r) => r.trips),
    boardings,
    revenue,
    // Occupied seats over seats offered, a ratio of sums: a big route outweighs a
    // small one, as it does on the road.
    loadFactor: capacity > 0 ? occupied / capacity : null,
    // How much of the total rests on the flat fare of a route of unknown length.
    flatFareRevenueShare: revenue > 0 ? sum(flat, (r) => r.revenue) / revenue : null,
    flatFareRouteShare: rows.length > 0 ? flat.length / rows.length : null,
    earningsPerKm:
      serviceKm > 0 ? Math.round((sum(priced, (r) => r.revenue) / serviceKm) * CENT) / CENT : null,
    earningsCoverage: { n: priced.length, of: rows.length },
    provenance: 'modelled',
  };
}

/**
 * Earnings per kilometre per route, only where the route's real length is
 * known (otherwise withheld with a reason, never computed from a guess), and
 * depot totals. All figures MODELLED; a used length is DERIVED. Output order
 * never depends on input order.
 */
export function analyseRevenue(days: readonly RouteRidershipDay[]): RevenueAnalysis {
  const perRoute = days
    .map(figureFor)
    .sort((a, b) => compareText(a.routeName, b.routeName) || a.revenue - b.revenue);
  return { perRoute, depot: totalsOf(perRoute) };
}
