import { formatCount } from '../format';
import { sortRows, type SortDirection, type SortValue } from '../tableSort';
import { toTenths } from './allocationWording';
import type { RouteListItem } from './api';

/**
 * The route table's filters, sort and paging, kept pure so the arithmetic is
 * tested without a browser. The whole filtered list is sorted before it is
 * paged, so a sort never reorders just the visible page.
 */

export const ROUTE_PAGE_SIZE = 25;
/** Class filter value for routes whose name carries no service class. Tokens are upper case. */
export const NO_CLASS = 'none';

export interface RouteFilters {
  /** Null for every depot. */
  readonly depotId: string | null;
  /** Null for every class; `NO_CLASS` for names without one. */
  readonly serviceClass: string | null;
}

export const NO_ROUTE_FILTERS: RouteFilters = { depotId: null, serviceClass: null };

export interface FilterOption {
  readonly value: string;
  readonly label: string;
}

/** Every depot that operates at least one route, by name then id. */
export function depotOptions(routes: readonly RouteListItem[]): FilterOption[] {
  const byId = new Map<string, string>();
  for (const route of routes) {
    for (const operator of route.operators) byId.set(operator.depotId, operator.depotName);
  }
  return [...byId.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'en') || a.value.localeCompare(b.value, 'en'));
}

/** Service classes present, alphabetical, then "No class in name" when any route lacks one. */
export function classOptions(routes: readonly RouteListItem[]): FilterOption[] {
  const tokens = new Set<string>();
  let anyWithout = false;
  for (const route of routes) {
    if (route.serviceToken === null) anyWithout = true;
    else tokens.add(route.serviceToken);
  }
  const named = [...tokens]
    .sort((a, b) => a.localeCompare(b, 'en'))
    .map((token) => ({ value: token, label: token }));
  return anyWithout ? [...named, { value: NO_CLASS, label: 'No class in name' }] : named;
}

export function filterRoutes(
  routes: readonly RouteListItem[],
  filters: RouteFilters,
): RouteListItem[] {
  return routes.filter((route) => {
    if (filters.depotId !== null && !route.operators.some((o) => o.depotId === filters.depotId)) {
      return false;
    }
    if (filters.serviceClass === null) return true;
    return filters.serviceClass === NO_CLASS
      ? route.serviceToken === null
      : route.serviceToken === filters.serviceClass;
  });
}

export type RouteSortKey =
  | 'route'
  | 'depot'
  | 'buses'
  | 'class'
  | 'trips'
  | 'deadKm'
  | 'median'
  | 'late'
  | 'profile';

export interface RouteSort {
  readonly key: RouteSortKey;
  readonly direction: SortDirection;
}

const SORT_VALUE: Readonly<Record<RouteSortKey, (route: RouteListItem) => SortValue>> = {
  route: (r) => r.routeName,
  // Operators are listed majority first, so the first one names the route's depot.
  depot: (r) => r.operators[0]?.depotName ?? null,
  buses: (r) => r.buses,
  class: (r) => r.serviceToken,
  trips: (r) => r.tripsPerDay.value,
  deadKm: (r) => (r.deadKm === null ? null : toTenths(r.deadKm.perTripKm)),
  median: (r) => r.delay.medianMin,
  late: (r) => r.delay.lateShare,
  profile: (r) => (r.profiled ? 1 : 0),
};

/** A sorted copy; null keeps the server's order (most buses first). */
export function sortRoutes(
  routes: readonly RouteListItem[],
  sort: RouteSort | null,
): readonly RouteListItem[] {
  return sort === null ? routes : sortRows(routes, SORT_VALUE[sort.key], sort.direction);
}

export interface Page<T> {
  readonly items: readonly T[];
  /** Zero-based, clamped into range. */
  readonly page: number;
  /** At least 1, so an empty list still has one (empty) page. */
  readonly pageCount: number;
  readonly offset: number;
  readonly total: number;
}

/** One page of `items`. A page past the end (the list shrank) becomes the last page. */
export function pageOf<T>(items: readonly T[], page: number, size: number = ROUTE_PAGE_SIZE): Page<T> {
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const clamped = Math.min(Math.max(0, Math.floor(page)), pageCount - 1);
  const offset = clamped * size;
  return {
    items: items.slice(offset, offset + size),
    page: clamped,
    pageCount,
    offset,
    total: items.length,
  };
}

/** "Showing 1–25 of 1,204 routes", naming the filter when it narrows the list. */
export function routeRangeSentence(
  page: { readonly offset: number; readonly shown: number; readonly total: number },
  inFeed: number,
): string {
  const filtered = page.total < inFeed;
  const outOf = `out of ${formatCount(inFeed)} in the feed`;
  if (page.shown === 0) return `No routes match these filters, ${outOf}`;
  const range = `Showing ${formatCount(page.offset + 1)}–${formatCount(page.offset + page.shown)} of ${formatCount(page.total)} ${
    page.total === 1 ? 'route' : 'routes'
  }`;
  return filtered ? `${range} that match these filters, ${outOf}` : range;
}
