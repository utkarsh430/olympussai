import type { AvailabilityGrid, NetworkMetrics, ScenarioRoute, Selection } from './types';

/*
 * The figures of a selection, from the routes and an availability (the current allocation
 * or a projected one). Pure, so the "before" and "after" figures come from one function.
 */

/** The longest a passenger is assumed to wait when an hour has no bus, in minutes. */
const MAX_HEADWAY_MIN = 120;
const MINUTES_PER_HOUR = 60;

export const hoursOf = (selection: Pick<Selection, 'fromHour' | 'toHour'>): readonly number[] =>
  Array.from({ length: selection.toHour - selection.fromHour + 1 }, (_, i) => selection.fromHour + i);

/** The share of an hour's demand the buses can carry: 1 when nothing is needed. */
export function cellCoverage(required: number, available: number): number {
  if (required <= 0) return 1;
  return Math.min(1, available / required);
}

/** Minutes between departures at this allocation, capped where there is no bus. */
export function headwayMin(route: Pick<ScenarioRoute, 'cycleHours'>, buses: number): number {
  if (buses <= 0) return MAX_HEADWAY_MIN;
  return Math.min(MAX_HEADWAY_MIN, (MINUTES_PER_HOUR * route.cycleHours) / buses);
}

/** The route's availability from the grid, else its own allocation. */
export function availabilityOf(route: ScenarioRoute, grid: AvailabilityGrid | null): readonly number[] {
  return grid?.get(route.id) ?? route.available;
}

/** Signed gap at an hour: positive short, negative surplus. */
export function gapAt(route: ScenarioRoute, hour: number, grid: AvailabilityGrid | null): number {
  return (route.required[hour] ?? 0) - (availabilityOf(route, grid)[hour] ?? 0);
}

/** Demand-weighted coverage of one route over the window, 0 to 1 (1 with no demand). */
export function routeCoverage(
  route: ScenarioRoute,
  grid: AvailabilityGrid | null,
  selection: Pick<Selection, 'fromHour' | 'toHour'>,
): number {
  const avail = availabilityOf(route, grid);
  let demand = 0;
  let covered = 0;
  for (const h of hoursOf(selection)) {
    const d = route.demand[h] ?? 0;
    demand += d;
    covered += d * cellCoverage(route.required[h] ?? 0, avail[h] ?? 0);
  }
  return demand === 0 ? 1 : covered / demand;
}

/** The whole selection's figures over the window. */
export function networkMetrics(
  routes: readonly ScenarioRoute[],
  grid: AvailabilityGrid | null,
  selection: Pick<Selection, 'fromHour' | 'toHour'>,
): NetworkMetrics {
  const hours = hoursOf(selection);
  const shortByHour = hours.map(() => 0);
  const surplusByHour = hours.map(() => 0);
  let routesShort = 0;
  let routesSurplus = 0;
  let shortageBusHours = 0;
  let surplusBusHours = 0;
  let demand = 0;
  let demandCovered = 0;
  let waitWeighted = 0;

  for (const route of routes) {
    const avail = availabilityOf(route, grid);
    let short = false;
    let surplus = false;
    hours.forEach((h, i) => {
      const need = route.required[h] ?? 0;
      const have = avail[h] ?? 0;
      const gap = need - have;
      if (gap > 0) {
        short = true;
        shortageBusHours += gap;
        shortByHour[i] = (shortByHour[i] ?? 0) + gap;
      } else if (gap < 0) {
        surplus = true;
        surplusBusHours -= gap;
        surplusByHour[i] = (surplusByHour[i] ?? 0) - gap;
      }
      const d = route.demand[h] ?? 0;
      demand += d;
      demandCovered += d * cellCoverage(need, have);
      if (d > 0) waitWeighted += d * (headwayMin(route, have) / 2);
    });
    if (short) routesShort += 1;
    if (surplus) routesSurplus += 1;
  }

  const peakSimultaneousShortage = Math.max(0, ...shortByHour);
  const peakIndex = shortByHour.indexOf(peakSimultaneousShortage);
  return {
    routes: routes.length,
    routesShort,
    routesSurplus,
    shortageBusHours,
    surplusBusHours,
    peakSimultaneousShortage,
    peakSimultaneousSurplus: Math.max(0, ...surplusByHour),
    peakShortageHour: peakSimultaneousShortage > 0 && peakIndex >= 0 ? (hours[peakIndex] ?? null) : null,
    demand,
    demandCovered,
    coverage: demand === 0 ? 1 : demandCovered / demand,
    meanWaitMin: demand === 0 ? 0 : waitWeighted / demand,
  };
}

/** A route's shortage and surplus bus-hours and its peak over the window, for sorting the heat map. */
export interface RouteWindowFigures {
  readonly shortageBusHours: number;
  readonly surplusBusHours: number;
  readonly peakShortage: number;
  readonly peakShortageHour: number | null;
  readonly peakDemand: number;
  readonly coverage: number;
}

export function routeWindowFigures(
  route: ScenarioRoute,
  grid: AvailabilityGrid | null,
  selection: Pick<Selection, 'fromHour' | 'toHour'>,
): RouteWindowFigures {
  const avail = availabilityOf(route, grid);
  let shortageBusHours = 0;
  let surplusBusHours = 0;
  let peakShortage = 0;
  let peakShortageHour: number | null = null;
  let peakDemand = 0;
  for (const h of hoursOf(selection)) {
    const gap = (route.required[h] ?? 0) - (avail[h] ?? 0);
    if (gap > 0) {
      shortageBusHours += gap;
      if (gap > peakShortage) {
        peakShortage = gap;
        peakShortageHour = h;
      }
    } else surplusBusHours -= gap;
    peakDemand = Math.max(peakDemand, route.demand[h] ?? 0);
  }
  return {
    shortageBusHours,
    surplusBusHours,
    peakShortage,
    peakShortageHour,
    peakDemand,
    coverage: routeCoverage(route, grid, selection),
  };
}
