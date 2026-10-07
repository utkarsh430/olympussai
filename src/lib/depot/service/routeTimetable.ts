import { compareText } from '../stats/order';
import { borrowedDates } from './busDay';
import type { ScheduledTrip } from './types';

/*
 * What is known of a route's timetable for one date, by bus: the buses seen on the route
 * (what a loader may look up), those whose whole day is recorded (what it skips, and the
 * scheduled coverage), and the dates whose timetable was borrowed for this one. Pure.
 */

export interface RouteTimetableInput {
  /** Registrations this server saw carrying the route name earlier in the date. */
  readonly heldBuses: readonly string[];
  /** Registrations carrying the route name in this snapshot. */
  readonly snapshotBuses: readonly string[];
  /** Registrations with a recorded day for the date, whatever routes it runs. */
  readonly recordedBuses: readonly string[];
  /** Registrations whose recorded day runs this route. */
  readonly knownOnRoute: readonly string[];
  /** The recorded trips on the route for the date. */
  readonly trips: readonly ScheduledTrip[];
}

export interface RouteTimetable {
  /** Every bus seen on the route in the date, sorted. */
  readonly busesOnRoute: readonly string[];
  /** Of those, and of the buses whose recorded day runs the route, the ones with a recorded day. */
  readonly busesWithDay: readonly string[];
  /** Dates whose timetable stands in for this date's, sorted; empty when none. */
  readonly borrowedFrom: readonly string[];
}

const sortedSet = (values: Iterable<string>): string[] => [...new Set(values)].sort(compareText);

export function routeTimetable(input: Readonly<RouteTimetableInput>): RouteTimetable {
  const busesOnRoute = sortedSet([...input.heldBuses, ...input.snapshotBuses]);
  const recorded = new Set(input.recordedBuses);
  const busesWithDay = sortedSet([
    ...busesOnRoute.filter((bus) => recorded.has(bus)),
    ...input.knownOnRoute,
  ]);
  return { busesOnRoute, busesWithDay, borrowedFrom: borrowedDates(input.trips) };
}
