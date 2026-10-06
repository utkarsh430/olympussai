import type { Coverage } from '../types';
import { scheduledHoursFromLedger } from './journeyLedger';
import type { LedgerJourney, ScheduledRouteHour, ScheduledTrip } from './types';

/*
 * A route's scheduled supply for one date from everything known of its timetable: the
 * journeys the feed itself reported and the trips of the bus days looked up from the
 * schedule service. Pure. Both are placed by the same rule (`scheduledHoursFromLedger`),
 * so a trip counts the same whichever way it became known.
 */

export interface ScheduledSupplyInput {
  readonly routeName: string;
  readonly operatingDate: string;
  /** The day's journeys from the feed's rows (other routes and dates are ignored). */
  readonly ledger: readonly LedgerJourney[];
  /** Trips of the looked-up bus days (other routes and dates are ignored). */
  readonly trips: readonly ScheduledTrip[];
  /** Distinct buses seen carrying the route name on the date. */
  readonly distinctBusesSeen: number;
}

export interface ScheduledSupply {
  /** 24 hours when any trip with a start is known; none otherwise, so no hour claims a zero. */
  readonly hours: readonly ScheduledRouteHour[];
  /** Buses whose trips are known, of the buses seen on the route (never fewer than are known). */
  readonly coverage: Coverage;
}

/** A looked-up trip in the ledger's shape; it has no actual start or delay. */
function asJourney(trip: ScheduledTrip, operatingDate: string): LedgerJourney {
  return {
    operatingDate,
    journeyId: trip.journeyId,
    routeName: trip.routeName,
    registrationNumber: trip.registrationNumber,
    scheduledStart: trip.startTime,
    scheduledEnd: trip.endTime,
    actualStart: null,
    delayMinutes: null,
    lastSeen: '',
  };
}

/**
 * The scheduled bus-hours per hour and the coverage they rest on. A trip the feed already
 * reported (the same journey id) is counted once, from the feed; a bus is counted once
 * however many of its trips are known.
 */
export function scheduledSupply(input: Readonly<ScheduledSupplyInput>): ScheduledSupply {
  const { routeName, operatingDate } = input;
  const fromFeed = input.ledger.filter(
    (j) => j.routeName === routeName && j.operatingDate === operatingDate,
  );
  const feedIds = new Set(fromFeed.map((j) => j.journeyId));
  const looked = input.trips
    .filter((t) => t.routeName === routeName && t.forDate === operatingDate)
    .filter((t) => !feedIds.has(t.journeyId))
    .map((t) => asJourney(t, operatingDate));
  const journeys = [...fromFeed, ...looked];
  const buses = new Set(journeys.map((j) => j.registrationNumber));
  const coverage = { n: buses.size, of: Math.max(buses.size, input.distinctBusesSeen) };
  if (!journeys.some((j) => j.scheduledStart !== null)) return { hours: [], coverage };
  const hours = scheduledHoursFromLedger(routeName, operatingDate, journeys, coverage).map(
    (hour) => ({ ...hour, fromFeedRowsOnly: looked.length === 0 }),
  );
  return { hours, coverage };
}
