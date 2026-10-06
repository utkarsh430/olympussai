import { sortRows, type SortValue } from '../tableSort';
import type { FilterOption, RouteListItem } from './api';
import { NO_CLASS, type ListPage, type RouteSort, type RouteSortKey } from './routeQuery';

/**
 * The route lists' filters, sort and paging, applied on the server so a
 * response carries one page and true totals. Each whole filtered list is
 * sorted before it is paged, so a sort never reorders only the visible page.
 */

const tenths = (km: number): number => Math.round(km * 10);

const SORT_VALUE: Readonly<Record<RouteSortKey, (route: RouteListItem) => SortValue>> = {
  route: (r) => r.routeName,
  // Operators are listed majority first, so the first one names the route's depot.
  depot: (r) => r.operators[0]?.depotName ?? null,
  buses: (r) => r.buses,
  class: (r) => r.serviceToken,
  trips: (r) => r.tripsPerDay.value,
  // Compared in tenths, as the figure is shown, never by floating-point equality.
  deadKm: (r) => (r.deadKm === null ? null : tenths(r.deadKm.perTripKm)),
  median: (r) => r.delay.medianMin,
  late: (r) => r.delay.lateShare,
  profile: (r) => (r.profiled ? 1 : 0),
};

/** A sorted copy; null keeps the table's order (most buses first). */
export function sortRoutes(
  routes: readonly RouteListItem[],
  sort: RouteSort | null,
): readonly RouteListItem[] {
  return sort === null ? routes : sortRows(routes, SORT_VALUE[sort.key], sort.direction);
}

/** Case-insensitive part of a route name; null matches every name. */
export function nameMatches(routeName: string, q: string | null): boolean {
  return q === null || routeName.toUpperCase().includes(q.toUpperCase());
}

export function inClass(route: RouteListItem, serviceClass: string | null): boolean {
  if (serviceClass === null) return true;
  return serviceClass === NO_CLASS
    ? route.serviceToken === null
    : route.serviceToken === serviceClass;
}

/** One page of a list; a page past the end is empty, and the total is always the whole list's. */
export function pageItems<T>(items: readonly T[], page: ListPage): readonly T[] {
  return items.slice(page.offset, page.offset + page.limit);
}

/** How many items carry each reason, every reason present (zero when none). */
export function countByReason<R extends string>(
  items: readonly { readonly reason: R }[],
  reasons: readonly R[],
): Readonly<Record<R, number>> {
  const counts = Object.fromEntries(reasons.map((r) => [r, 0])) as Record<R, number>;
  for (const item of items) counts[item.reason] += 1;
  return counts;
}

const byLabel = (a: FilterOption, b: FilterOption): number =>
  a.label.localeCompare(b.label, 'en') || a.value.localeCompare(b.value, 'en');

/** Every depot that operates at least one route, by name then id. */
export function depotOptions(routes: readonly RouteListItem[]): FilterOption[] {
  const byId = new Map<string, string>();
  for (const route of routes) {
    for (const operator of route.operators) byId.set(operator.depotId, operator.depotName);
  }
  return [...byId.entries()].map(([value, label]) => ({ value, label })).sort(byLabel);
}

/** Service classes present, alphabetical, then "No class in name" when any route lacks one. */
export function classOptions(routes: readonly RouteListItem[]): FilterOption[] {
  const tokens = new Set<string>();
  let anyWithout = false;
  for (const route of routes) {
    if (route.serviceToken === null) anyWithout = true;
    else tokens.add(route.serviceToken);
  }
  const named = [...tokens].map((token) => ({ value: token, label: token })).sort(byLabel);
  return anyWithout ? [...named, { value: NO_CLASS, label: 'No class in name' }] : named;
}
