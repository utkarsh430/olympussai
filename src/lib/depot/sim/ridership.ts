import { SeededRandom } from '../../simulation/seededRandom';
import { compareText } from '../fuel/compare';
import type { RevenueBasis, RouteRidershipDay, RouteRidershipInput } from '../revenue/types';
import { clamp } from '../stats/robust';
import { STATIC_SEED_DATE } from './config';
import {
  AVG_TRIP_LENGTH_SHARE,
  DAILY_NOISE_SALT,
  FARE_PER_KM,
  FLAT_FARE_PER_BOARDING,
  LOAD_FACTOR_BASE,
  LOAD_FACTOR_DAILY_NOISE,
  LOAD_FACTOR_ROUTE_SPREAD,
  MAX_LOAD_FACTOR,
  MAX_PLAUSIBLE_LENGTH_KM,
  MAX_SEATS_PER_BUS,
  ROUTE_FACTOR_SALT,
} from './revenueConfig';
import { seedFor } from './seed';
import { modelTripsPerDay } from './tripFrequency';

const THOUSAND = 1000;

/** A real, plausible length, or null: an unknown length is never guessed. */
function usableLength(lengthKm: number | null): number | null {
  if (lengthKm === null || !Number.isFinite(lengthKm)) return null;
  return lengthKm > 0 && lengthKm <= MAX_PLAUSIBLE_LENGTH_KM ? lengthKm : null;
}

function wholeSeats(seatsPerBus: number): number {
  if (!Number.isFinite(seatsPerBus) || seatsPerBus < 1) return 0;
  return Math.min(Math.round(seatsPerBus), MAX_SEATS_PER_BUS);
}

/**
 * Class base, moved by a lasting per-route factor (seeded by route name alone,
 * so it holds on every date) and a small seeded daily noise, then capped.
 */
function modelLoadFactor(input: Readonly<RouteRidershipInput>, operatingDate: string): number {
  const lasting = new SeededRandom(seedFor(input.routeName, STATIC_SEED_DATE, ROUTE_FACTOR_SALT));
  const daily = new SeededRandom(seedFor(input.routeName, operatingDate, DAILY_NOISE_SALT));
  const raw =
    LOAD_FACTOR_BASE[input.serviceClass] *
    (1 + lasting.float(-LOAD_FACTOR_ROUTE_SPREAD, LOAD_FACTOR_ROUTE_SPREAD)) *
    (1 + daily.float(-LOAD_FACTOR_DAILY_NOISE, LOAD_FACTOR_DAILY_NOISE));
  return Math.min(MAX_LOAD_FACTOR, Math.round(clamp(raw, 0, MAX_LOAD_FACTOR) * THOUSAND) / THOUSAND);
}

function dayFor(input: Readonly<RouteRidershipInput>, operatingDate: string): RouteRidershipDay {
  const { tripsPerDay: trips } = modelTripsPerDay(
    {
      routeName: input.routeName,
      buses: input.buses,
      scheduledDurationMin: input.scheduledDurationMin,
    },
    operatingDate,
  );
  const seatsPerTrip = wholeSeats(input.seatsPerBus);
  const seatCapacity = trips * seatsPerTrip;
  const loadFactor = modelLoadFactor(input, operatingDate);
  // Floored, so rounding can never carry boardings past the capped load factor.
  const boardings = Math.floor(seatCapacity * loadFactor);
  const lengthKm = usableLength(input.lengthKm);
  const fare =
    lengthKm === null
      ? FLAT_FARE_PER_BOARDING
      : FARE_PER_KM[input.serviceClass] * AVG_TRIP_LENGTH_SHARE * lengthKm;
  const revenueBasis: RevenueBasis = lengthKm === null ? 'flat_fare_unknown_length' : 'length_known';
  return {
    routeName: input.routeName,
    serviceClass: input.serviceClass,
    trips,
    seatsPerTrip,
    seatCapacity,
    loadFactor,
    boardings,
    revenue: Math.round(boardings * fare),
    lengthKm,
    revenueBasis,
    provenance: 'modelled',
  };
}

/**
 * One MODELLED day of ridership and revenue per route. Deterministic per route
 * name and operating date. Trips come from the trip-frequency model; boardings
 * are seats times a capped load factor; revenue is boardings times a modelled
 * fare. Output is sorted so input order never matters.
 */
export function modelRidershipDay(
  routes: readonly RouteRidershipInput[],
  operatingDate: string,
): RouteRidershipDay[] {
  return routes
    .map((route) => dayFor(route, operatingDate))
    .sort((a, b) => compareText(a.routeName, b.routeName) || a.revenue - b.revenue);
}
