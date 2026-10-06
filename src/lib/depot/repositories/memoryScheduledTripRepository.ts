import type { ScheduledTrip } from '../service/types';
import { compareText } from '../stats/order';
import type { ScheduledTripRepository } from './types';

/*
 * The scheduled trips of the bus days looked up from the schedule service,
 * held in memory per process until a timetable store exists. Per date asked
 * for, each bus's whole day; recording a bus and date again replaces its day.
 * It never reads the wall clock. Bounds: SCHEDULED_TRIPS_MAX_BUSES buses per
 * date (a bus past the cap is not recorded) and the SCHEDULED_TRIPS_MAX_DATES
 * latest dates (the earliest goes when a later one arrives).
 */

export const SCHEDULED_TRIPS_MAX_BUSES = 2000;
export const SCHEDULED_TRIPS_MAX_DATES = 3;

type BusDays = Map<string, readonly ScheduledTrip[]>;

function byStart(a: ScheduledTrip, b: ScheduledTrip): number {
  return (
    compareText(a.startTime, b.startTime) ||
    compareText(a.registrationNumber, b.registrationNumber) ||
    compareText(a.journeyId, b.journeyId)
  );
}

/** Groups trips by date asked for, then by registration. */
function groupDays(trips: readonly ScheduledTrip[]): Map<string, Map<string, ScheduledTrip[]>> {
  const days = new Map<string, Map<string, ScheduledTrip[]>>();
  for (const trip of trips) {
    const buses = days.get(trip.forDate) ?? new Map<string, ScheduledTrip[]>();
    buses.set(trip.registrationNumber, [...(buses.get(trip.registrationNumber) ?? []), trip]);
    days.set(trip.forDate, buses);
  }
  return days;
}

function dropEarliestDates(dates: Map<string, BusDays>): void {
  const sorted = [...dates.keys()].sort(compareText);
  for (const date of sorted.slice(0, Math.max(0, sorted.length - SCHEDULED_TRIPS_MAX_DATES))) {
    dates.delete(date);
  }
}

/** A fresh, empty store: the state of a process that has just started. */
export function createMemoryScheduledTripRepository(): ScheduledTripRepository {
  const dates = new Map<string, BusDays>();
  const tripsOn = (routeName: string, forDate: string): ScheduledTrip[] =>
    [...(dates.get(forDate)?.values() ?? [])].flatMap((day) =>
      day.filter((t) => t.routeName === routeName),
    );
  return {
    async recordBusDay(trips): Promise<void> {
      for (const [forDate, buses] of groupDays(trips)) {
        const held: BusDays = dates.get(forDate) ?? new Map();
        for (const [registration, day] of buses) {
          if (!held.has(registration) && held.size >= SCHEDULED_TRIPS_MAX_BUSES) continue;
          held.set(registration, [...day].sort(byStart));
        }
        dates.set(forDate, held);
      }
      dropEarliestDates(dates);
    },
    async tripsForRoute(routeName, forDate): Promise<readonly ScheduledTrip[]> {
      return tripsOn(routeName, forDate).sort(byStart);
    },
    async knownBusesOnRoute(routeName, forDate): Promise<readonly string[]> {
      const buses = new Set(tripsOn(routeName, forDate).map((t) => t.registrationNumber));
      return [...buses].sort(compareText);
    },
  };
}

const GLOBAL_KEY = '__depotScheduledTripStore';
type GlobalWithStore = typeof globalThis & { [GLOBAL_KEY]?: ScheduledTripRepository };

/** The one process-wide store; on `globalThis` so a dev reload does not fork it. */
function processStore(): ScheduledTripRepository {
  const holder = globalThis as GlobalWithStore;
  holder[GLOBAL_KEY] ??= createMemoryScheduledTripRepository();
  return holder[GLOBAL_KEY];
}

export const memoryScheduledTripRepository: ScheduledTripRepository = processStore();
