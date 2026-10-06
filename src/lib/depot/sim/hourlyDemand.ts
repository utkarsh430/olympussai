import { SeededRandom } from '../../simulation/seededRandom';
import type { RouteHourDemand } from '../service/types';
import {
  DEFAULT_ACTIVE_HOURS,
  DEMAND_BAND_SHARE,
  DEMAND_BASIS,
  HOUR_SHAPE_BY_CLASS,
  HOURLY_DEMAND_SALT,
  HOURLY_JITTER,
  HOURS_PER_DAY,
  LONG_ROUTE_DEPARTURE_SHAPE,
  LONG_ROUTE_JOURNEY_MIN,
  LONG_ROUTE_LEAN,
  MIN_SERVICE_HOURS,
} from './hourlyDemandConfig';
import { seedFor } from './seed';
import type { ServiceClass } from './types';

export interface HourlyDemandInput {
  readonly routeName: string;
  readonly operatingDate: string;
  readonly serviceClass: ServiceClass;
  /** One-way journey minutes; null when unknown (the class shape is used as it stands). */
  readonly journeyMinutes: number | null;
  /** The route's modelled boardings for the whole day (the ridership model's figure). */
  readonly dayBoardings: number;
  /** Hours the route runs at all (0 to 23); empty for the default daytime. */
  readonly activeHours: readonly number[];
}

const HOURS: readonly number[] = Array.from({ length: HOURS_PER_DAY }, (_, h) => h);

/**
 * The class's hour-of-day shape, moved toward departure hours on a long route
 * (journey over LONG_ROUTE_JOURNEY_MIN): its passengers board where the journey
 * starts. Both shapes sum to 1, so the blend does too.
 */
export function hourShapeFor(
  serviceClass: ServiceClass,
  journeyMinutes: number | null,
): readonly number[] {
  const shape = HOUR_SHAPE_BY_CLASS[serviceClass];
  if (journeyMinutes === null || !(journeyMinutes > LONG_ROUTE_JOURNEY_MIN)) return shape;
  return shape.map(
    (w, h) => (1 - LONG_ROUTE_LEAN) * w + LONG_ROUTE_LEAN * (LONG_ROUTE_DEPARTURE_SHAPE[h] ?? 0),
  );
}

/** The marked hours in range, or the default daytime when too few are marked to describe a day. */
function activeSet(marked: readonly number[]): ReadonlySet<number> {
  const valid = new Set(marked.filter((h) => Number.isInteger(h) && h >= 0 && h < HOURS_PER_DAY));
  if (valid.size >= MIN_SERVICE_HOURS) return valid;
  return new Set(
    HOURS.filter((h) => h >= DEFAULT_ACTIVE_HOURS.from && h <= DEFAULT_ACTIVE_HOURS.to),
  );
}

/**
 * Splits a whole total over weights in whole units by largest remainder, so the
 * parts always sum to the total exactly. Ties go to the earlier hour.
 */
function allocate(total: number, weights: readonly number[]): number[] {
  const weightSum = weights.reduce((s, w) => s + w, 0);
  if (total <= 0 || weightSum <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / weightSum);
  const floors = exact.map(Math.floor);
  const left = total - floors.reduce((s, f) => s + f, 0);
  const order = exact
    .map((x, i) => ({ i, rem: x - Math.floor(x) }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i)
    .slice(0, left)
    .map((r) => r.i);
  const bumped = new Set(order);
  return floors.map((f, i) => (bumped.has(i) ? f + 1 : f));
}

/**
 * MODELLED boardings per hour for one route on one date. The day's total is an
 * input (the ridership model's boardings for the route), spread by the class
 * shape, moved by a seeded jitter per hour, kept to the hours the route runs
 * and renormalised so the hours sum to the total exactly. Deployment marks only
 * which hours are active; it never shapes demand. Pure and seeded by route and
 * date: the same input always answers the same 24 hours.
 */
export function modelHourlyDemand(input: Readonly<HourlyDemandInput>): RouteHourDemand[] {
  const total = Number.isFinite(input.dayBoardings)
    ? Math.max(0, Math.round(input.dayBoardings))
    : 0;
  const shape = hourShapeFor(input.serviceClass, input.journeyMinutes);
  const active = activeSet(input.activeHours);
  // Draw for every hour in a fixed order, so the active hours never shift the stream.
  const rng = new SeededRandom(seedFor(input.routeName, input.operatingDate, HOURLY_DEMAND_SALT));
  const jitter = HOURS.map(() => rng.float(1 - HOURLY_JITTER, 1 + HOURLY_JITTER));
  const weights = HOURS.map((h) => (active.has(h) ? (shape[h] ?? 0) * (jitter[h] ?? 1) : 0));
  const boardings = allocate(total, weights);
  return HOURS.map((hour) => {
    const b = boardings[hour] ?? 0;
    return {
      routeName: input.routeName,
      operatingDate: input.operatingDate,
      hour,
      boardings: b,
      band: {
        low: Math.round(b * (1 - DEMAND_BAND_SHARE)),
        high: Math.round(b * (1 + DEMAND_BAND_SHARE)),
      },
      provenance: 'modelled',
      basis: DEMAND_BASIS,
    };
  });
}
