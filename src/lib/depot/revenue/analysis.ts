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
  const priced = rows.filter((r) => r.serviceKm !== null && r.serviceKm > 0);
  const serviceKm = sum(priced, (r) => r.serviceKm ?? 0);
  return {
    routes: rows.length,
    trips: sum(rows, (r) => r.trips),
    boardings,
    revenue: sum(rows, (r) => r.revenue),
    // Ratio of sums: a big route outweighs a small one, as it does on the road.
    loadFactor: capacity > 0 ? boardings / capacity : null,
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
