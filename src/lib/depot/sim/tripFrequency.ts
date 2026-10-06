import { SeededRandom } from '../../simulation/seededRandom';
import { clamp } from '../stats/robust';
import { seedFor } from './seed';
import {
  LONG_ROUTE_MIN,
  MAX_BUSES_PER_ROUTE,
  MAX_PLAUSIBLE_DURATION_MIN,
  SHORT_ROUTE_MIN,
  TRIP_FACTOR_NOISE,
  TRIP_FACTOR_RANGE,
  TRIP_FREQUENCY_SALT,
  UNKNOWN_DURATION_FACTOR,
} from './tripFrequencyConfig';

/**
 * Which live figures a modelled trip count rests on. `bus_count_over_cap`
 * refuses a route with more buses than the model accepts: it is not modelled
 * (zero trips), and the allocator excludes it for the same reason.
 */
export type TripBasis = 'buses_and_duration' | 'buses_only' | 'bus_count_over_cap';

export interface TripFrequencyInput {
  readonly routeName: string;
  /** Buses carrying the route name in the live snapshot. */
  readonly buses: number;
  /** From the route's profile; null when the route has not been profiled. */
  readonly scheduledDurationMin: number | null;
}

export interface ModelledTrips {
  /** Whole depot-anchored trips per day; zero only for a route with no whole bus. */
  readonly tripsPerDay: number;
  /** The per-bus factor used, two decimals. */
  readonly perBus: number;
  readonly basis: TripBasis;
}

const FACTOR_DECIMALS = 100;

/** A whole bus count; anything not a finite positive number is no bus. */
function busCount(buses: number): number {
  if (!Number.isFinite(buses) || buses < 1) return 0;
  return Math.floor(buses);
}

/** True when the route has more buses than the trip model (and so the allocator) accepts. */
export function overBusCap(buses: number): boolean {
  return busCount(buses) > MAX_BUSES_PER_ROUTE;
}

function usableDuration(minutes: number | null): number | null {
  if (minutes === null || !Number.isFinite(minutes)) return null;
  return minutes > 0 && minutes <= MAX_PLAUSIBLE_DURATION_MIN ? minutes : null;
}

/** Two runs at or below the short bound, one at or above the long bound, linear between. */
function durationFactor(minutes: number): number {
  const { min, max } = TRIP_FACTOR_RANGE;
  const share = clamp((minutes - SHORT_ROUTE_MIN) / (LONG_ROUTE_MIN - SHORT_ROUTE_MIN), 0, 1);
  return max - share * (max - min);
}

/**
 * Modelled trips per day for one route: the buses seen on it times a per-bus
 * factor anchored on its scheduled duration where known, varied by a seed of
 * route name and operating date, and held inside the factor range. The
 * variation does not depend on the bus count, so more buses never yields fewer
 * trips. Always a finite whole number, at least the bus count.
 */
export function modelTripsPerDay(
  input: Readonly<TripFrequencyInput>,
  operatingDate: string,
): ModelledTrips {
  if (overBusCap(input.buses)) return { tripsPerDay: 0, perBus: 0, basis: 'bus_count_over_cap' };
  const buses = busCount(input.buses);
  const duration = usableDuration(input.scheduledDurationMin);
  const basis: TripBasis = duration === null ? 'buses_only' : 'buses_and_duration';
  const base = duration === null ? UNKNOWN_DURATION_FACTOR : durationFactor(duration);
  const rng = new SeededRandom(seedFor(input.routeName, operatingDate, TRIP_FREQUENCY_SALT));
  const varied = base * rng.float(1 - TRIP_FACTOR_NOISE, 1 + TRIP_FACTOR_NOISE);
  const factor = clamp(varied, TRIP_FACTOR_RANGE.min, TRIP_FACTOR_RANGE.max);
  const perBus = Math.round(factor * FACTOR_DECIMALS) / FACTOR_DECIMALS;
  const tripsPerDay = buses === 0 ? 0 : Math.max(buses, Math.round(buses * factor));
  return { tripsPerDay, perBus, basis };
}
