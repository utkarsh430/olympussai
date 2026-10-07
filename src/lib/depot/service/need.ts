import { median } from '../stats/robust';
import { SEATS_BY_CLASS } from '../sim/config';
import { classFromRoute } from '../sim/fleetMaster';
import {
  BUSIEST_STRETCH_SHARE,
  HOURS_PER_DAY,
  LAYOVER_MIN,
  TARGET_LOAD,
} from '../sim/hourlyDemandConfig';
import {
  LONG_ROUTE_MIN,
  MAX_PLAUSIBLE_DURATION_MIN,
  SHORT_ROUTE_MIN,
  TRIP_FACTOR_RANGE,
  UNKNOWN_DURATION_FACTOR,
} from '../sim/tripFrequencyConfig';
import type { ServiceClass } from '../sim/types';
import { MINUTES_PER_HOUR } from '../units';
import { spanMinutes } from './feedMinutes';
import type { LedgerJourney, NeedInputs } from './types';

/**
 * The journey minutes the trip model assumes for a route it knows nothing
 * about: the duration at which its per-bus factor equals the factor it uses
 * for an unknown duration (linear between the short and long bounds), so the
 * two models never disagree about an unprofiled route. 285 minutes today.
 */
export const TRIP_MODEL_DURATION_MIN =
  SHORT_ROUTE_MIN +
  ((TRIP_FACTOR_RANGE.max - UNKNOWN_DURATION_FACTOR) /
    (TRIP_FACTOR_RANGE.max - TRIP_FACTOR_RANGE.min)) *
    (LONG_ROUTE_MIN - SHORT_ROUTE_MIN);

/** Absorbs floating-point dust before rounding up, so 16.000000001 buses is 16. */
const CEIL_TOLERANCE = 1e-9;

/** The class a route's name states, ordinary when it states none (as the modelled day reads it). */
export function serviceClassOfRoute(routeName: string): ServiceClass {
  return classFromRoute(routeName) ?? 'ordinary';
}

function plausibleMinutes(minutes: number | null): number | null {
  if (minutes === null || !Number.isFinite(minutes)) return null;
  return minutes > 0 && minutes <= MAX_PLAUSIBLE_DURATION_MIN ? minutes : null;
}

/**
 * The route's journey minutes from the feed's own schedule: the median of
 * scheduled end minus scheduled start over the route's journeys that carry
 * both, or null when none does.
 */
export function journeyMinutesFromLedger(
  routeName: string,
  ledger: readonly LedgerJourney[],
): number | null {
  const spans = ledger
    .filter((j) => j.routeName === routeName)
    .map((j) => plausibleMinutes(spanMinutes(j.scheduledStart, j.scheduledEnd)))
    .filter((m): m is number => m !== null);
  const middle = median(spans);
  return middle === null ? null : Math.round(middle);
}

export interface NeedSource {
  readonly routeName: string;
  /** The day's journey ledger (any routes; only this route's journeys are read). */
  readonly ledger: readonly LedgerJourney[];
  /** The cached route profile's scheduled duration; null when the route is not profiled. */
  readonly profileDurationMin: number | null;
}

/**
 * What the need formula is given for a route. Journey minutes come from the
 * feed's schedule (DERIVED), else the route profile (DERIVED), else the trip
 * model's assumption (MODELLED); seats are the class's in the modelled fleet
 * master; the rest are the REFERENCE planning constants.
 */
export function needInputsFor(source: Readonly<NeedSource>): NeedInputs {
  const serviceClass = serviceClassOfRoute(source.routeName);
  const fromLedger = journeyMinutesFromLedger(source.routeName, source.ledger);
  const fromProfile = plausibleMinutes(source.profileDurationMin);
  const known = fromLedger ?? fromProfile;
  return {
    routeName: source.routeName,
    serviceClass,
    seatsPerBus: SEATS_BY_CLASS[serviceClass],
    journeyMinutes: known ?? Math.round(TRIP_MODEL_DURATION_MIN),
    journeyMinutesProvenance: known === null ? 'modelled' : 'derived',
    layoverMinutes: LAYOVER_MIN,
    targetLoad: TARGET_LOAD,
    busiestStretchShare: BUSIEST_STRETCH_SHARE,
  };
}

/** Boardings one trip carries at the target load, counted over the whole route. */
export function boardingsPerTrip(inputs: Readonly<NeedInputs>): number {
  return (inputs.seatsPerBus * inputs.targetLoad) / inputs.busiestStretchShare;
}

/** Trips one bus makes in an hour: an hour over a journey plus its layover. */
export function tripsPerBusHour(inputs: Readonly<NeedInputs>): number {
  return MINUTES_PER_HOUR / (inputs.journeyMinutes + inputs.layoverMinutes);
}

/** Trips that must start in an hour to carry its boardings; none for no demand or a corrupt figure. */
function tripsFor(boardings: number | undefined, inputs: Readonly<NeedInputs>): number {
  if (boardings === undefined || !Number.isFinite(boardings) || boardings <= 0) return 0;
  return boardings / boardingsPerTrip(inputs);
}

/**
 * Trips needed to start in each hour of the day: the hour's boardings x busiest-stretch
 * share ÷ (seats x target load). Always 24 values; a missing or corrupt hour needs none.
 */
export function tripsNeededByHour(
  boardingsByHour: readonly number[],
  inputs: Readonly<NeedInputs>,
): number[] {
  return Array.from({ length: HOURS_PER_DAY }, (_, h) => tripsFor(boardingsByHour[h], inputs));
}

/**
 * Buses needed on the road in each hour: every trip started within the last cycle
 * (journey + layover) is still out, so the need at hour h is the trips started in the
 * hours (h - cycle, h], the oldest weighted by the share of it inside the window, rounded
 * up. The day starts clean: nothing wraps from the evening before. On a cycle of an hour
 * or less this is the hour's trips times the cycle, the round-trip figure; on a steady day
 * it reaches that figure once a cycle has passed. Always 24 values.
 */
export function busesNeededByHour(
  boardingsByHour: readonly number[],
  inputs: Readonly<NeedInputs>,
): number[] {
  const trips = tripsNeededByHour(boardingsByHour, inputs);
  const cycleHours = 1 / tripsPerBusHour(inputs);
  const whole = Math.floor(cycleHours);
  const part = cycleHours - whole;
  return trips.map((_, h) => {
    const full = trips.slice(Math.max(0, h - whole + 1), h + 1).reduce((s, t) => s + t, 0);
    const oldest = h - whole >= 0 ? (trips[h - whole] ?? 0) * part : 0;
    // Never below none: rounding up the tolerance on an empty window would give -0.
    return Math.max(0, Math.ceil(full + oldest - CEIL_TOLERANCE));
  });
}
