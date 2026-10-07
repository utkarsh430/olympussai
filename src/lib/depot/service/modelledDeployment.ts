import { SeededRandom } from '../../simulation/seededRandom';
import { drawDutyStart, type DutySpan } from '../sim/duties';
import {
  HOURS_PER_DAY,
  LAYOVER_MIN,
  ROUTE_BUS_DAY_MAX_MIN,
  ROUTE_BUS_DAY_MIN,
} from '../sim/hourlyDemandConfig';
import { seedFor } from '../sim/seed';
import { overBusCap } from '../sim/tripFrequency';
import { MINUTES_PER_HOUR } from '../units';
import type { ModelledRouteHour } from './types';

const TENTHS = 10;
const ROUND_TO_MIN = 5;
const DAY_END_MIN = HOURS_PER_DAY * MINUTES_PER_HOUR;
/** Keeps a route's own duties apart from any other stream seeded by the route and date. */
const ROUTE_DUTIES_SALT = 'route-duties';

/** The route's own fleet for the day, as the snapshot shows it. */
export interface RouteFleetInput {
  readonly routeName: string;
  readonly operatingDate: string;
  /** Buses carrying the route name in the snapshot, whatever their state. */
  readonly buses: number;
  /** One-way journey minutes when known (the feed's schedule or the profile); null when not known. */
  readonly journeyMinutes: number | null;
}

/** Minutes of [start, end) that fall inside the hour. */
function overlap(span: DutySpan, hour: number): number {
  const from = hour * MINUTES_PER_HOUR;
  const to = from + MINUTES_PER_HOUR;
  return Math.max(0, Math.min(span.endMin, to) - Math.max(span.startMin, from));
}

const isKnown = (minutes: number | null): minutes is number =>
  minutes !== null && Number.isFinite(minutes) && minutes > 0;

/**
 * One bus's working day on the route: it starts as the depot duty roll starts a duty (the
 * morning triangle or spread over the day) and works a seeded 6 to 10 hours, or one journey
 * and its layover when that is longer, at most 16 hours, clipped at the end of the day.
 * The length is always drawn so the stream stays aligned whether the journey is known.
 */
export function drawRouteBusDay(rng: SeededRandom, journeyMinutes: number | null): DutySpan {
  const startMin = drawDutyStart(rng);
  const drawn = rng.float(ROUTE_BUS_DAY_MIN.from, ROUTE_BUS_DAY_MIN.to);
  const oneJourney = isKnown(journeyMinutes) ? journeyMinutes + LAYOVER_MIN : 0;
  const length = Math.min(
    ROUTE_BUS_DAY_MAX_MIN,
    Math.round(Math.max(drawn, oneJourney) / ROUND_TO_MIN) * ROUND_TO_MIN,
  );
  return { startMin, endMin: Math.min(DAY_END_MIN, startMin + length) };
}

/** A whole bus count; none for anything not a finite positive number or past the trip model's cap. */
function wholeBuses(buses: number): number {
  if (!Number.isFinite(buses) || buses < 1 || overBusCap(buses)) return 0;
  return Math.floor(buses);
}

/**
 * A route's MODELLED deployment per hour, for the hours this server did not
 * observe, anchored to the route's own buses: each bus carrying the route name
 * in the snapshot works one day on it (`drawRouteBusDay`: a start as the depot
 * duty roll draws one, then 6 to 10 hours or one journey and its layover when
 * longer), seeded by route and date. An hour's figure is the bus-hours of those
 * days inside it (buses running the route, as an observed hour counts in service
 * plus on the road), one decimal. Always 24 hours.
 */
export function modelledRouteHours(input: Readonly<RouteFleetInput>): ModelledRouteHour[] {
  const rng = new SeededRandom(seedFor(input.routeName, input.operatingDate, ROUTE_DUTIES_SALT));
  const spans = Array.from({ length: wholeBuses(input.buses) }, () =>
    drawRouteBusDay(rng, input.journeyMinutes),
  );
  return Array.from({ length: HOURS_PER_DAY }, (_, hour) => {
    const minutes = spans.reduce((sum, span) => sum + overlap(span, hour), 0);
    return {
      routeName: input.routeName,
      operatingDate: input.operatingDate,
      hour,
      deployed: Math.round((minutes / MINUTES_PER_HOUR) * TENTHS) / TENTHS,
    };
  });
}
