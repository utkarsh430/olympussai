import { SeededRandom } from '../../simulation/seededRandom';
import { drawDutySpan, type DutySpan } from '../sim/duties';
import { HOURS_PER_DAY } from '../sim/hourlyDemandConfig';
import { seedFor } from '../sim/seed';
import { overBusCap } from '../sim/tripFrequency';
import { MINUTES_PER_HOUR } from '../units';
import type { ModelledRouteHour } from './types';

const TENTHS = 10;
/** Keeps a route's own duties apart from any other stream seeded by the route and date. */
const ROUTE_DUTIES_SALT = 'route-duties';

/** The route's own fleet for the day, as the snapshot shows it. */
export interface RouteFleetInput {
  readonly routeName: string;
  readonly operatingDate: string;
  /** Buses carrying the route name in the snapshot, whatever their state. */
  readonly buses: number;
  /** One-way journey minutes when known (the feed's schedule or the profile); null draws 4-10 hours. */
  readonly journeyMinutes: number | null;
}

/** Minutes of [start, end) that fall inside the hour. */
function overlap(span: DutySpan, hour: number): number {
  const from = hour * MINUTES_PER_HOUR;
  const to = from + MINUTES_PER_HOUR;
  return Math.max(0, Math.min(span.endMin, to) - Math.max(span.startMin, from));
}

/** A whole bus count; none for anything not a finite positive number or past the trip model's cap. */
function wholeBuses(buses: number): number {
  if (!Number.isFinite(buses) || buses < 1 || overBusCap(buses)) return 0;
  return Math.floor(buses);
}

/**
 * A route's MODELLED deployment per hour, for the hours this server did not
 * observe, anchored to the route's own buses: each bus carrying the route name
 * in the snapshot runs one duty, drawn by the depot duty roll's rules (a start
 * in the morning peak or spread over the day; out and back plus a layover when
 * the journey is known, else 4-10 hours), seeded by route and date. An hour's
 * figure is the bus-hours of those duties inside it (buses running the route,
 * as an observed hour counts in service plus on the road), one decimal. A duty
 * past midnight counts only up to 24:00. Always 24 hours.
 */
export function modelledRouteHours(input: Readonly<RouteFleetInput>): ModelledRouteHour[] {
  const rng = new SeededRandom(seedFor(input.routeName, input.operatingDate, ROUTE_DUTIES_SALT));
  const spans = Array.from({ length: wholeBuses(input.buses) }, () =>
    drawDutySpan(rng, input.journeyMinutes),
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
