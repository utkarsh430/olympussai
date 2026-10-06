import { formatCount } from '../format';
import type { DepotAllocationResponse, FilterOption } from './api';
import { PROFILE_LOAD_CAP } from './profileLoader';

/**
 * The plan panel's one row when nothing can be planned: the sentence, the depot select and
 * the "Load route details" button. Route details are loaded only by a person's press (the
 * owner's decision: no background crawl of the corporation's route service), so the row
 * makes the next step obvious: the depot most worth a press is chosen already.
 */

/** A depot in the loader's select, with the buses that report a route there now. */
export interface LoaderDepot extends FilterOption {
  /** Buses of this depot carrying a route name; null when the network feed has not said. */
  readonly busesOnRoutes: number | null;
}

export const LOADER_COST_LINE = 'One lookup on the route-details service per route, one at a time';

/**
 * The depots that run a route, most buses on a route first (the server sends no per-depot
 * route count, so buses on routes stand in for it), then by name.
 */
export function loaderDepots(
  options: readonly FilterOption[],
  summaries: readonly { readonly id: string; readonly assigned: number }[],
): readonly LoaderDepot[] {
  const buses = new Map(summaries.map((s) => [s.id, s.assigned]));
  return options
    .map((o) => ({ ...o, busesOnRoutes: buses.get(o.value) ?? null }))
    .sort(
      (a, b) =>
        (b.busesOnRoutes ?? -1) - (a.busesOnRoutes ?? -1) || a.label.localeCompare(b.label, 'en'),
    );
}

/** The depot scope from the URL when it runs a route, else the depot with the most buses on routes. */
export function defaultLoaderDepot(
  depots: readonly LoaderDepot[],
  scopeDepotId: string | null,
): string {
  if (scopeDepotId !== null && depots.some((d) => d.value === scopeDepotId)) return scopeDepotId;
  return depots[0]?.value ?? '';
}

/** An option's words: the name, then its buses on routes when known. */
export function loaderDepotLabel(depot: LoaderDepot): string {
  if (depot.busesOnRoutes === null) return depot.label;
  return `${depot.label} · ${formatCount(depot.busesOnRoutes)} on routes`;
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
