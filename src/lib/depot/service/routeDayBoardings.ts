import { SEATS_BY_CLASS } from '../sim/config';
import { modelLoadFactor } from '../sim/ridership';
import { dayBoardings } from '../sim/ridershipFigures';
import { modelTripsPerDay } from '../sim/tripFrequency';
import type { ServiceClass } from '../sim/types';
import type { RouteFleetInput } from './modelledDeployment';
import { serviceClassOfRoute } from './need';

/** A route's modelled day of boardings and what it rests on. */
export interface RouteDayBoardings {
  readonly serviceClass: ServiceClass;
  /** Modelled trips per day on the route's own buses, the Routes table's "trips/day". */
  readonly trips: number;
  /** The class's seats in the modelled fleet master. */
  readonly seatsPerTrip: number;
  /** The route's modelled load factor for the date, as the revenue model draws it. */
  readonly loadFactor: number;
  readonly boardings: number;
}

/**
 * A route's MODELLED boardings for the day, anchored to the route's own buses:
 * the trip model's trips per day on the buses carrying the route name (the
 * figure the Routes table shows), times the class's seats, times the route's
 * modelled load factor, by the revenue model's rule (two legs a trip, each
 * carrying seats x load factor over the average ride share). So boardings follow
 * the route's modelled trips, as on the revenue page, and the same route, date
 * and trips give the same figure there and here.
 */
export function routeDayBoardings(input: Readonly<RouteFleetInput>): RouteDayBoardings {
  const serviceClass = serviceClassOfRoute(input.routeName);
  const { tripsPerDay } = modelTripsPerDay(
    { routeName: input.routeName, buses: input.buses, scheduledDurationMin: input.journeyMinutes },
    input.operatingDate,
  );
  const seatsPerTrip = SEATS_BY_CLASS[serviceClass];
  const loadFactor = modelLoadFactor(input.routeName, serviceClass, input.operatingDate);
  return {
    serviceClass,
    trips: tripsPerDay,
    seatsPerTrip,
    loadFactor,
    boardings: dayBoardings(tripsPerDay, seatsPerTrip, loadFactor),
  };
}
