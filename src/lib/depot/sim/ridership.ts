import { SeededRandom } from '../../simulation/seededRandom';
import { compareText } from '../fuel/compare';
import type { RouteRidershipDay } from '../revenue/types';
import { clamp } from '../stats/robust';
import { SEATS_BY_CLASS, STATIC_SEED_DATE } from './config';
import type { DayRoute, OperatingDay } from './operatingDayTypes';
import {
  DAILY_NOISE_SALT,
  LOAD_FACTOR_BASE,
  LOAD_FACTOR_DAILY_NOISE,
  LOAD_FACTOR_ROUTE_SPREAD,
  MAX_LOAD_FACTOR,
  MAX_SEATS_PER_BUS,
  ROUTE_FACTOR_SALT,
} from './revenueConfig';
import { priceRoute } from './ridershipFigures';
import { seedFor } from './seed';

const THOUSAND = 1000;

/** Average seats of the buses that ran the route, whole; the class figure when none ran. */
function seatsPerTripOf(route: DayRoute): number {
  if (route.trips === 0) return SEATS_BY_CLASS[route.serviceClass];
  return Math.min(Math.round(route.seatsOffered / route.trips), MAX_SEATS_PER_BUS);
}

/**
 * Class base, moved by a lasting per-route factor (seeded by route name alone,
 * so it holds on every date) and a small seeded daily noise, then capped.
 */
function modelLoadFactor(route: DayRoute, operatingDate: string): number {
  const lasting = new SeededRandom(seedFor(route.routeName, STATIC_SEED_DATE, ROUTE_FACTOR_SALT));
  const daily = new SeededRandom(seedFor(route.routeName, operatingDate, DAILY_NOISE_SALT));
  const raw =
    LOAD_FACTOR_BASE[route.serviceClass] *
    (1 + lasting.float(-LOAD_FACTOR_ROUTE_SPREAD, LOAD_FACTOR_ROUTE_SPREAD)) *
    (1 + daily.float(-LOAD_FACTOR_DAILY_NOISE, LOAD_FACTOR_DAILY_NOISE));
  return Math.min(MAX_LOAD_FACTOR, Math.round(clamp(raw, 0, MAX_LOAD_FACTOR) * THOUSAND) / THOUSAND);
}

function dayFor(route: DayRoute, operatingDate: string): RouteRidershipDay {
  const seatsPerTrip = seatsPerTripOf(route);
  const loadFactor = modelLoadFactor(route, operatingDate);
  const priced = priceRoute({
    serviceClass: route.serviceClass,
    trips: route.trips,
    seats: seatsPerTrip,
    loadFactor,
    lengthKm: route.lengthKm,
  });
  return {
    routeName: route.routeName,
    serviceClass: route.serviceClass,
    trips: route.trips,
    seatsPerTrip,
    // The seats actually offered, not trips x a rounded average (review M5).
    seatCapacity: route.trips === 0 ? 0 : route.seatsOffered,
    loadFactor,
    ...priced,
    lengthKm: route.lengthKm,
    lengthProvenance: route.lengthProvenance,
    serviceKm: route.serviceKm,
    provenance: 'modelled',
  };
}

/**
 * One MODELLED day of ridership and revenue per route of the operating day.
 * Trips are the day's own: the duties on the route that a bus ran, one trip
 * out and back each. This answers "what did the depot run and earn today". The
 * trip-frequency model (tripFrequency.ts) answers a different question, how
 * often the buses seen on a route now would turn round, and feeds the route
 * allocation only. Sorted by route name.
 */
export function modelRidershipDay(day: OperatingDay): RouteRidershipDay[] {
  return day.routes
    .map((route) => dayFor(route, day.operatingDate))
    .sort((a, b) => compareText(a.routeName, b.routeName));
}
