import type { DepotFeedEnvelope } from '../api';
import { isValidRouteName } from '../ids';
import type { ScheduledTrip } from './types';

/*
 * One bus's whole day from the corporation's schedule server, looked up on a person's
 * request: the shapes the endpoint answers with and its URL, shared by the server and the
 * page's loader.
 */

/** The endpoint, one bus per path, the route it was seen on as `?route=`. */
export const SCHEDULE_DAY_ENDPOINT = '/api/upsrtc/depot/schedule-day';

/** The day was read and recorded for the operating date. */
export interface ScheduleDayLoaded {
  readonly status: 'ok';
  readonly registrationNumber: string;
  /** The operating date the day is used for (the feed's own date). */
  readonly forDate: string;
  /** The date the server answered with; another than `forDate` is a borrowed day. */
  readonly answeredDate: string;
  /** Every trip of the bus's day, other routes included. */
  readonly trips: readonly ScheduledTrip[];
  /** How many of them run the route asked about. */
  readonly tripsOnRoute: number;
}

/**
 * No day was recorded: the server said the bus has no assignment on any date it was asked
 * (`no_schedule`), or it gave no usable answer, or only the stand-in sample was at hand
 * (`upstream_error`). Nothing is remembered, so the next request asks again.
 */
export interface ScheduleDayUnavailable {
  readonly status: 'unavailable';
  readonly reason: 'no_schedule' | 'upstream_error';
}

export type ScheduleDayResult = ScheduleDayLoaded | ScheduleDayUnavailable;

export type ScheduleDayResponse = ScheduleDayResult & DepotFeedEnvelope;

/** The URL for one bus seen on one route; null when either is malformed, so nothing is asked. */
export function scheduleDayUrl(registration: string, routeName: string): string | null {
  if (!/^[A-Z0-9]{1,16}$/i.test(registration) || !isValidRouteName(routeName)) return null;
  const route = new URLSearchParams({ route: routeName }).toString();
  return `${SCHEDULE_DAY_ENDPOINT}/${encodeURIComponent(registration)}?${route}`;
}
