import { minuteOfDay } from './feedMinutes';
import { NOT_RUN_AFTER_MIN } from './proposalConfig';
import type { ProposalContext } from './proposals';
import { routeJourneys } from './scheduledSupply';
import type { LedgerJourney } from './types';

/*
 * The loaded timetable's trips not run. A loaded trip counts only when its absence is a
 * fact this server could have seen: its start is more than NOT_RUN_AFTER_MIN behind the
 * feed clock and no earlier than the time this server began observing the date, its bus
 * reports its journeys on the feed's rows (it carried another journey of the route today),
 * and the feed never reported this journey. Most buses report no journey at all, so a
 * trip of such a bus says nothing either way and is left out.
 */

/** The loaded trips judged not run, in the ledger's shape; none without a feed clock or an observation. */
export function loadedTripsNotRun(ctx: ProposalContext): LedgerJourney[] {
  const now = ctx.feedMinute;
  const since = minuteOfDay(ctx.observedSince ?? null);
  if (now === null || since === null) return [];
  const { fromFeed, looked } = routeJourneys(ctx.routeName, ctx.operatingDate, ctx.ledger, ctx.trips ?? []);
  const reporting = new Set(fromFeed.map((j) => j.registrationNumber));
  return looked.filter((trip) => {
    const start = minuteOfDay(trip.scheduledStart);
    return (
      start !== null &&
      start >= since &&
      now - start > NOT_RUN_AFTER_MIN &&
      reporting.has(trip.registrationNumber)
    );
  });
}
