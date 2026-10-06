import { median } from '../stats/robust';
import { SEATS_BY_CLASS } from '../sim/config';
import { classFromRoute } from '../sim/fleetMaster';
import {
  BUSIEST_STRETCH_SHARE,
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
  ((TRIP_FACTOR_RANGE.max - UNKNOWN_DURATION_FACTOR) / (TRIP_FACTOR_RANGE.max - TRIP_FACTOR_RANGE.min)) *
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

/**
 * Buses needed in an hour: trips needed = boardings x busiest-stretch share ÷
 * (seats x target load); buses = trips x (journey + layover) ÷ 60, rounded up.
 * No demand (or a figure that is not a positive number) needs no bus.
 */
export function busesNeeded(demandBoardings: number, inputs: Readonly<NeedInputs>): number {
  if (!Number.isFinite(demandBoardings) || demandBoardings <= 0) return 0;
  const trips = demandBoardings / boardingsPerTrip(inputs);
  return Math.ceil(trips / tripsPerBusHour(inputs) - CEIL_TOLERANCE);
}
