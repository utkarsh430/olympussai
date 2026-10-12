import { busesNeededByHour } from '../service/need';
import { compareText } from '../stats/order';
import { FULL_SCALE } from './config';
import type { DepotRouteNeed, ResolvedScheduleParams, RouteHourNeed, ScheduleInput, ScheduleRouteInput } from './types';

/*
 * Stage A: the depot's need per route per hour. A route's need is network
 * wide; the depot takes its share of the route's buses, whole buses by
 * largest remainder so the operators sum to the route's need.
 */

/** The whole buses of `routeNeeded` that fall to `depotId` by its share of the route's buses. */
export function apportion(
  routeNeeded: number,
  operators: readonly { readonly depotId: string; readonly buses: number }[],
  depotId: string,
): number {
  const total = operators.reduce((sum, o) => sum + Math.max(0, o.buses), 0);
  if (routeNeeded <= 0) return 0;
  if (total <= 0) return operators.some((o) => o.depotId === depotId) ? routeNeeded : 0;
  const shares = operators.map((o) => {
    const exact = (routeNeeded * Math.max(0, o.buses)) / total;
    return { depotId: o.depotId, floor: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let left = routeNeeded - shares.reduce((sum, s) => sum + s.floor, 0);
  const order = [...shares].sort((a, b) => b.remainder - a.remainder || compareText(a.depotId, b.depotId));
  const extra = new Set<string>();
  for (const share of order) {
    if (left <= 0) break;
    extra.add(share.depotId);
    left -= 1;
  }
  const mine = shares.find((s) => s.depotId === depotId);
  return mine === undefined ? 0 : mine.floor + (extra.has(depotId) ? 1 : 0);
}

function surgedBoardings(route: ScheduleRouteInput, params: ResolvedScheduleParams): number[] {
  const own = params.routeSurges.find((s) => s.routeName === route.need.routeName)?.percent ?? 0;
  const factor = (FULL_SCALE + (params.demandSurgePercent + own) * (FULL_SCALE / 100)) / FULL_SCALE;
  return route.need.boardingsByHour.map((b) => Math.max(0, b * factor));
}

function routeNeedOf(input: ScheduleInput, route: ScheduleRouteInput, params: ResolvedScheduleParams): DepotRouteNeed {
  const need = { ...route.need.need, targetLoad: params.targetLoad, journeyMinutes: route.timing.journeyMinutes, layoverMinutes: route.timing.layoverMinutes };
  const network = busesNeededByHour(surgedBoardings(route, params), need);
  const hours: RouteHourNeed[] = network.map((routeNeeded, hour) => ({
    hour,
    routeNeeded,
    needed: apportion(routeNeeded, route.operatorBuses, input.depot.id),
  }));
  return {
    routeName: route.need.routeName,
    serviceClass: need.serviceClass,
    need,
    cycleMinutes: route.timing.cycleMinutes,
    hours,
    needProvenance: route.need.provenance,
    timingProvenance: route.timing.provenance,
  };
}

/** Every route of the depot with its apportioned need; routes needing nothing all day are listed apart. */
export function depotRouteNeeds(
  input: ScheduleInput,
  params: ResolvedScheduleParams,
): { readonly routes: readonly DepotRouteNeed[]; readonly routesWithoutNeed: readonly string[] } {
  const all = [...input.routes]
    .sort((a, b) => compareText(a.need.routeName, b.need.routeName))
    .map((route) => routeNeedOf(input, route, params));
  const routes = all.filter((r) => r.hours.some((h) => h.needed > 0));
  const routesWithoutNeed = all.filter((r) => r.hours.every((h) => h.needed === 0)).map((r) => r.routeName);
  return { routes, routesWithoutNeed };
}
