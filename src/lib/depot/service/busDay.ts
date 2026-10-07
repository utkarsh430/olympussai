import type { ScheduledTrip } from './types';

/*
 * A bus's day as the schedule server answered it, made the day of the operating date it
 * was looked up for. The server may answer with an earlier date when the asked one is not
 * assigned; that day is then used for the operating date, and each trip keeps the date
 * that answered so the page can say the timetable was borrowed.
 */

/** The trips re-stamped for `forDate`; `answeredDate` is kept as the server gave it. */
export function busDayFor(trips: readonly ScheduledTrip[], forDate: string): ScheduledTrip[] {
  return trips.map((trip) => ({ ...trip, forDate }));
}

/** The dates that answered for a day used on another date, sorted; empty when none was borrowed. */
export function borrowedDates(trips: readonly ScheduledTrip[]): string[] {
  const dates = new Set(trips.filter((t) => t.answeredDate !== t.forDate).map((t) => t.answeredDate));
  return [...dates].sort();
}
