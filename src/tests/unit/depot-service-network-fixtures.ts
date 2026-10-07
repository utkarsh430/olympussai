import type { NetworkRouteDay } from '@/lib/depot/service/networkHours';
import type { HourBasis, RouteHourFigures } from '@/lib/depot/service/types';
import { routeHourlyFixture } from './depot-service-fixtures';

/*
 * Crafted route days for the network tests: each route is given its deployed and needed
 * buses per hour (24 each, or a constant), the depot running it, and which hours were
 * measured. Demand is set to the need times 40 boardings, so impact and need agree in sign.
 */

export interface CraftedRoute {
  readonly routeName: string;
  readonly depotId: string | null;
  readonly depotName?: string;
  readonly deployed: number | readonly number[];
  readonly needed: number | readonly number[];
  /** Hours whose deployment was observed; every other hour is modelled. */
  readonly measured?: readonly number[];
}

const at = (v: number | readonly number[], hour: number): number =>
  typeof v === 'number' ? v : (v[hour] ?? 0);

function hourOf(route: CraftedRoute, hour: number): RouteHourFigures {
  const deployed = at(route.deployed, hour);
  const needed = at(route.needed, hour);
  const basis: HourBasis = route.measured?.includes(hour) ? 'observed' : 'modelled';
  const demand = needed * 40;
  return {
    hour,
    deployed,
    deployedBasis: basis,
    slotsObserved: basis === 'observed' ? 12 : 0,
    scheduled: null,
    scheduledTripsStarting: null,
    demand,
    demandBand: { low: demand * 0.75, high: demand * 1.25 },
    needed,
    gap: Math.round((needed - deployed) * 10) / 10,
    delayMedianMin: null,
    lateShare: null,
    delayCoverage: { n: 0, of: 0 },
  };
}

/** A route's day on the network, as the view hands it to the pure models. */
export function craftedDay(route: CraftedRoute): NetworkRouteDay {
  const base = routeHourlyFixture();
  return {
    day: {
      ...base,
      routeName: route.routeName,
      hours: Array.from({ length: 24 }, (_, h) => hourOf(route, h)),
      proposals: [],
    },
    depotId: route.depotId,
    depotName: route.depotId === null ? null : (route.depotName ?? `Depot ${route.depotId}`),
  };
}
