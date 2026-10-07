import { logDepotError } from '@/lib/serverLog';
import { fetchBusSchedule, ScheduleLookupStopped } from '@/lib/upsrtc/scheduleService';
import type { RateDecision } from '../rateLimit';
import type { FleetSnapshotView, ServiceRepositories } from '../repositories/types';
import type { LimitedLookup, UpstreamPermit } from '../routes/routeCatalogue';
import { operatingDateOf } from '../sim/seed';
import { busDayFor } from './busDay';
import type { ScheduleDayResult } from './scheduleDayApi';
import type { ScheduledTrip } from './types';

/*
 * One bus's whole day from the corporation's schedule server, asked for on a person's
 * request and only for a bus this server has seen on the route: the feed's operating date
 * first, then the fallback dates, each call charged to the caller's permit as it is made.
 * A real answer is recorded in the scheduled-trip store for the operating date; "not
 * assigned", a failure, a refused call or the stand-in sample records nothing.
 */

export interface ScheduleDayRequest {
  /** Upper-cased and validated by the caller. */
  readonly registration: string;
  readonly routeName: string;
  readonly view: FleetSnapshotView;
  readonly services: ServiceRepositories;
  readonly permit: UpstreamPermit;
  readonly now: number;
}

export type ScheduleDayOutcome =
  | ScheduleDayResult
  | LimitedLookup
  | { readonly status: 'not_on_route' };

/** Seen carrying the route name now, or earlier in the operating date. */
async function seenOnRoute(request: ScheduleDayRequest, operatingDate: string): Promise<boolean> {
  const { view, registration, routeName, services } = request;
  const now = view.rows.some(
    (row) => row.routeName === routeName && row.registrationNumber.toUpperCase() === registration,
  );
  if (now) return true;
  return (await services.hourly.busesOnRoute(routeName, operatingDate)).includes(registration);
}

/** The bus's day for the operating date, recorded when the server answered with one. */
export async function lookUpScheduleDay(request: ScheduleDayRequest): Promise<ScheduleDayOutcome> {
  const { view, registration, routeName, services, permit, now } = request;
  const operatingDate = operatingDateOf(view.feedNow, view.fetchedAt);
  if (!(await seenOnRoute(request, operatingDate))) return { status: 'not_on_route' };
  const refusal: { decision: RateDecision | null } = { decision: null };
  const held: { day: readonly ScheduledTrip[] | null } = { day: null };
  try {
    const response = await fetchBusSchedule(
      { regNum: registration, date: operatingDate, tripId: null },
      now,
      {
        today: operatingDate,
        requireEveryDateAnswered: true,
        beforeUpstreamCall: () => {
          const decision = permit();
          if (decision.limited) refusal.decision = decision;
          return !decision.limited;
        },
        onDay: (trips) => {
          held.day = trips;
        },
      },
    );
    // The stand-in sample is not this bus's day: never present or record it as one.
    if (response.source === 'fixture') return { status: 'unavailable', reason: 'upstream_error' };
    if (response.schedule === null || held.day === null) {
      return { status: 'unavailable', reason: 'no_schedule' };
    }
  } catch (error) {
    if (error instanceof ScheduleLookupStopped && refusal.decision !== null) {
      return { status: 'limited', retryAfterSeconds: refusal.decision.retryAfterSeconds };
    }
    logDepotError('schedule-day', error);
    return { status: 'unavailable', reason: 'upstream_error' };
  }
  const trips = busDayFor(held.day, operatingDate);
  await services.scheduled.recordBusDay(trips);
  return {
    status: 'ok',
    registrationNumber: registration,
    forDate: operatingDate,
    answeredDate: trips[0]?.answeredDate ?? operatingDate,
    trips,
    tripsOnRoute: trips.filter((t) => t.routeName === routeName).length,
  };
}
