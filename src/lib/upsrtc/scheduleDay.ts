import type { ScheduledTrip } from '@/lib/depot/service/types';
import {
  extractArray,
  groupByTrip,
  isRecord,
  pick,
  ROUTE_NAME_ALIASES,
  SERVICE_ALIASES,
  STOP_SEQ_ALIASES,
  STOP_TIME_ALIASES,
  toNumber,
  toStringOrNull,
  UNKNOWN_TRIP,
} from './normalizer';

/*
 * The schedule server answers with every journey a bus runs that day. The single-trip
 * normaliser (`normalizeSchedulePayload`) keeps the one being run; this keeps them all,
 * one `ScheduledTrip` each, so a bus's whole day can be recorded as scheduled supply.
 */

type Row = Record<string, unknown>;

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/;

/** `HH:MM` from the server's `HH:MM[:SS]`; null for anything else. */
function clockOf(row: Row): string | null {
  const value = toStringOrNull(pick(row, STOP_TIME_ALIASES));
  const match = value === null ? null : CLOCK.exec(value);
  return match ? `${match[1]}:${match[2]}` : null;
}

/** The trip's rows in stop order (the server's order breaks ties). */
function inStopOrder(rows: readonly Row[]): Row[] {
  const sequence = (row: Row, index: number): number => toNumber(pick(row, STOP_SEQ_ALIASES)) ?? index + 1;
  return rows
    .map((row, index) => ({ row, at: sequence(row, index), index }))
    .sort((a, b) => a.at - b.at || a.index - b.index)
    .map((entry) => entry.row);
}

/**
 * One trip, or null without a route name or any readable time. The start and end are the
 * first and last timed stops in stop order, so a trip that runs past midnight ends at a
 * clock earlier than its start rather than at its earliest stop.
 */
function tripOf(
  journeyId: string,
  rows: readonly Row[],
  registrationNumber: string,
  forDate: string,
): ScheduledTrip | null {
  const ordered = inStopOrder(rows);
  const first = ordered[0];
  const routeName = first === undefined ? null : toStringOrNull(pick(first, ROUTE_NAME_ALIASES));
  const times = ordered.map(clockOf).filter((t): t is string => t !== null);
  const startTime = times[0];
  if (first === undefined || routeName === null || startTime === undefined) return null;
  return {
    forDate,
    answeredDate: forDate,
    registrationNumber,
    journeyId,
    journeyCode: toStringOrNull(pick(first, SERVICE_ALIASES)),
    routeName,
    startTime,
    endTime: times.length > 1 ? (times[times.length - 1] ?? null) : null,
    stops: ordered.length,
  };
}

/**
 * Every journey of the bus's day for `forDate` (the date the server was asked for, so
 * `answeredDate` is the same; a caller that borrowed a fallback date re-stamps `forDate`),
 * ordered by start then journey id. "Not assigned", an empty or unreadable payload is no
 * trips; a journey with no id, no route name or no readable time is left out.
 */
export function normalizeScheduleDay(
  payload: unknown,
  registration: string,
  forDate: string,
): ScheduledTrip[] {
  const rows = extractArray(payload).filter(isRecord);
  const registrationNumber = registration.trim().toUpperCase();
  return [...groupByTrip(rows)]
    .filter(([journeyId]) => journeyId !== UNKNOWN_TRIP)
    .map(([journeyId, trip]) => tripOf(journeyId, trip, registrationNumber, forDate))
    .filter((trip): trip is ScheduledTrip => trip !== null)
    .sort((a, b) => (a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : 0) ||
      (a.journeyId < b.journeyId ? -1 : a.journeyId > b.journeyId ? 1 : 0));
}
