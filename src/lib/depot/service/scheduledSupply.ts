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
  /** Buses whose whole day is recorded for the date: the coverage's count. */
  readonly busesWithDay: number;
}

export interface ScheduledSupply {
  /** 24 hours when any trip with a start is known; none otherwise, so no hour claims a zero. */
  readonly hours: readonly ScheduledRouteHour[];
  /** Buses whose whole day is recorded, of the buses seen on the route (never fewer than are known). */
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
 * reported (the same journey id) is counted once, from the feed. The coverage counts the
 * buses whose whole day is recorded: a journey the feed reported shows one trip of a bus,
 * never its day.
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
  const coverage = {
    n: input.busesWithDay,
    of: Math.max(input.busesWithDay, input.distinctBusesSeen),
  };
  if (!journeys.some((j) => j.scheduledStart !== null)) return { hours: [], coverage };
  const hours = scheduledHoursFromLedger(routeName, operatingDate, journeys, coverage).map(
    (hour) => ({ ...hour, fromFeedRowsOnly: looked.length === 0 }),
  );
  return { hours, coverage };
}
