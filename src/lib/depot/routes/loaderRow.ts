import { formatCount } from '../format';
import type { DepotAllocationResponse, FilterOption } from './api';
import { PROFILE_LOAD_CAP } from './profileLoader';

/**
 * The plan panel's one row when nothing can be planned: the sentence, the depot select and
 * the "Load route details" button. Route details are loaded only by a person's press (the
 * owner's decision: no background crawl of the corporation's route service), so the row
 * makes the next step obvious: the depot most worth a press is chosen already.
 */

/** A depot option as the routes response sends it: its number of routes when it says. */
export type DepotOption = FilterOption & { readonly routes?: number };

/** A depot in the loader's select, with its routes, or the buses that report a route there. */
export interface LoaderDepot extends FilterOption {
  /** The depot's number of routes in the feed, when the response carries it. */
  readonly routes: number | null;
  /** Buses of this depot carrying a route name; null when the network feed has not said. */
  readonly busesOnRoutes: number | null;
}

export const LOADER_COST_LINE = 'One lookup on the route-details service per route, one at a time';

/** What a depot is ordered by: its routes when known, else its buses on routes. */
function weight(d: LoaderDepot): number {
  return d.routes ?? d.busesOnRoutes ?? -1;
}

/**
 * The depots that run a route, most routes first (a press looks up one depot's routes, so
 * the count of routes is what a reader weighs; where the response does not carry it, buses
 * on routes stand in, labelled as such), then by name.
 */
export function loaderDepots(
  options: readonly DepotOption[],
  summaries: readonly { readonly id: string; readonly assigned: number }[],
): readonly LoaderDepot[] {
  const buses = new Map(summaries.map((s) => [s.id, s.assigned]));
  return options
    .map((o) => ({
      value: o.value,
      label: o.label,
      routes: typeof o.routes === 'number' && Number.isFinite(o.routes) ? o.routes : null,
      busesOnRoutes: buses.get(o.value) ?? null,
    }))
    .sort((a, b) => weight(b) - weight(a) || a.label.localeCompare(b.label, 'en'));
}

/** The depot scope from the URL when it runs a route, else the depot with the most buses on routes. */
export function defaultLoaderDepot(
  depots: readonly LoaderDepot[],
  scopeDepotId: string | null,
): string {
  if (scopeDepotId !== null && depots.some((d) => d.value === scopeDepotId)) return scopeDepotId;
  return depots[0]?.value ?? '';
}

/** An option's words: the name, then its routes, or else its buses on routes, when known. */
export function loaderDepotLabel(depot: LoaderDepot): string {
  if (depot.routes !== null) {
    return `${depot.label} · ${formatCount(depot.routes)} ${depot.routes === 1 ? 'route' : 'routes'}`;
  }
  if (depot.busesOnRoutes === null) return depot.label;
  return `${depot.label} · ${formatCount(depot.busesOnRoutes)} buses on routes`;
}

/** The row's sentence when no route can be planned: why, in one sentence. */
export function planRowSentence(allocation: DepotAllocationResponse): string {
  const loaded = allocation.coverage.profiled.n;
  if (loaded <= 0) return "No route can be planned yet: no route's details have been loaded.";
  const routes = `${formatCount(loaded)} ${loaded === 1 ? 'route' : 'routes'}`;
  return `No route can be planned yet: none of the ${routes} with details loaded can be measured from a depot.`;
}

/** The button's `title`: what one press costs. */
export function loadButtonTitle(depotName: string, routes: number): string {
  const n = `${formatCount(routes)} ${routes === 1 ? 'route' : 'routes'}`;
  return `Looks up ${n} of ${depotName} on the route-details service: one lookup per route, one at a time, at most ${PROFILE_LOAD_CAP} a press.`;
}
