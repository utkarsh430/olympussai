import type { DepotBusView } from '../api';
import type {
  RevenueRepository,
  RouteFacts,
  RouteRidershipDay,
  RouteRidershipInput,
} from '../revenue/types';
import { modelBus } from '../sim/fleetMaster';
import { modelRidershipDay } from '../sim/ridership';
import type { ServiceClass } from '../sim/types';

/** Buses in these states run nothing, as in the fuel model, so they carry no riders. */
const IDLE_STATES: ReadonlySet<DepotBusView['state']> = new Set(['off_road', 'dark']);

/** Most specific first, so a tie in bus counts goes to the more specific class. */
const CLASS_ORDER: readonly ServiceClass[] = ['premium', 'ac', 'express', 'ordinary'];

interface Accumulator {
  readonly buses: number;
  readonly seats: number;
  readonly byClass: ReadonlyMap<ServiceClass, number>;
}

/** The route's class is that of most of its buses. */
function dominantClass(counts: ReadonlyMap<ServiceClass, number>): ServiceClass {
  return (
    [...CLASS_ORDER].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))[0] ?? 'ordinary'
  );
}

function accumulate(acc: Accumulator | undefined, serviceClass: ServiceClass, seats: number): Accumulator {
  const prior = acc ?? { buses: 0, seats: 0, byClass: new Map<ServiceClass, number>() };
  return {
    buses: prior.buses + 1,
    seats: prior.seats + seats,
    byClass: new Map(prior.byClass).set(serviceClass, (prior.byClass.get(serviceClass) ?? 0) + 1),
  };
}

function inputsFrom(
  buses: readonly DepotBusView[],
  routeFacts: readonly RouteFacts[],
): RouteRidershipInput[] {
  const facts = new Map(routeFacts.map((f) => [f.routeName, f] as const));
  const routes = new Map<string, Accumulator>();
  for (const view of buses) {
    if (view.routeName === null || IDLE_STATES.has(view.state)) continue;
    const modelled = modelBus(view.registrationNumber, view.routeName);
    routes.set(
      view.routeName,
      accumulate(routes.get(view.routeName), modelled.serviceClass, modelled.seats),
    );
  }
  return [...routes].map(([routeName, acc]) => ({
    routeName,
    serviceClass: dominantClass(acc.byClass),
    buses: acc.buses,
    seatsPerBus: acc.seats / acc.buses,
    scheduledDurationMin: facts.get(routeName)?.scheduledDurationMin ?? null,
    lengthKm: facts.get(routeName)?.lengthKm ?? null,
  }));
}

/**
 * Ridership and revenue generated from the live fleet and the routes it is
 * seen running. A ticketing feed is a new adapter behind the same interface.
 */
export const modelledRevenueRepository: RevenueRepository = {
  async ridershipDay(
    buses: readonly DepotBusView[],
    routeFacts: readonly RouteFacts[],
    operatingDate: string,
  ): Promise<readonly RouteRidershipDay[]> {
    return modelRidershipDay(inputsFrom(buses, routeFacts), operatingDate);
  },
};
