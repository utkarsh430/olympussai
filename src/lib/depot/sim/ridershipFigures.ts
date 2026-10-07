import { AVG_TRIP_LENGTH_SHARE, FARE_PER_KM, LEGS_PER_TRIP } from './revenueConfig';
import type { ServiceClass } from './types';

export interface RoutePricingInput {
  readonly serviceClass: ServiceClass;
  readonly trips: number;
  readonly seats: number;
  readonly loadFactor: number;
  /** One way: the real length, or the modelled typical length of the class. */
  readonly lengthKm: number;
}

export interface PricedRoute {
  readonly boardings: number;
  readonly revenue: number;
}

/**
 * Boardings one leg carries: seats x load factor over the average ride share,
 * floored to whole people (see revenueConfig).
 */
export function boardingsPerLeg(seats: number, loadFactor: number): number {
  return Math.floor((seats * loadFactor) / AVG_TRIP_LENGTH_SHARE);
}

/** A day's boardings: trips out and back, LEGS_PER_TRIP legs each, at boardingsPerLeg. */
export function dayBoardings(trips: number, seats: number, loadFactor: number): number {
  return trips * LEGS_PER_TRIP * boardingsPerLeg(seats, loadFactor);
}

/**
 * Boardings and revenue for a day (see revenueConfig for the definitions).
 * Per leg, occupied seat-kilometres are seats x load factor x length; the
 * boardings behind them are seats x load factor over the average ride share,
 * floored to whole people. Revenue prices the occupied seat-kilometres at the
 * class fare per kilometre, on every route: one without a real profile uses its
 * modelled length. Pure: same input, same output.
 */
export function priceRoute(input: Readonly<RoutePricingInput>): PricedRoute {
  const legs = input.trips * LEGS_PER_TRIP;
  const occupiedSeats = input.seats * input.loadFactor;
  const perLeg = occupiedSeats * input.lengthKm * FARE_PER_KM[input.serviceClass];
  return {
    boardings: dayBoardings(input.trips, input.seats, input.loadFactor),
    revenue: Math.round(legs * perLeg),
  };
}
