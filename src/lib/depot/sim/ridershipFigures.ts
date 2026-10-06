import type { RevenueBasis } from '../revenue/types';
import {
  AVG_TRIP_LENGTH_SHARE,
  FARE_PER_KM,
  FLAT_FARE_PER_BOARDING,
  LEGS_PER_TRIP,
} from './revenueConfig';
import type { ServiceClass } from './types';

export interface RoutePricingInput {
  readonly serviceClass: ServiceClass;
  readonly trips: number;
  readonly seats: number;
  readonly loadFactor: number;
  /** A usable real length, or null when it is unknown. */
  readonly lengthKm: number | null;
}

export interface PricedRoute {
  readonly boardings: number;
  readonly revenue: number;
  readonly revenueBasis: RevenueBasis;
}

/**
 * Boardings and revenue for a day (see revenueConfig for the definitions).
 * Per leg, occupied seat-kilometres are seats x load factor x length; the
 * boardings behind them are seats x load factor over the average ride share,
 * floored to whole people. A known length prices the occupied seat-kilometres
 * at the class fare per kilometre; an unknown one prices each boarding at the
 * flat fare. Pure: same input, same output.
 */
export function priceRoute(input: Readonly<RoutePricingInput>): PricedRoute {
  const legs = input.trips * LEGS_PER_TRIP;
  const occupiedSeats = input.seats * input.loadFactor;
  const boardingsPerLeg = Math.floor(occupiedSeats / AVG_TRIP_LENGTH_SHARE);
  const boardings = legs * boardingsPerLeg;
  if (input.lengthKm === null) {
    return {
      boardings,
      revenue: Math.round(boardings * FLAT_FARE_PER_BOARDING),
      revenueBasis: 'flat_fare_unknown_length',
    };
  }
  const perLeg = occupiedSeats * input.lengthKm * FARE_PER_KM[input.serviceClass];
  return { boardings, revenue: Math.round(legs * perLeg), revenueBasis: 'length_known' };
}
