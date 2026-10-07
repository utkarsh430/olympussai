import {
  runProfileLoader,
  type LoaderDeps,
  type LoaderProgress,
  type LookupOutcome,
} from '../routes/profileLoader';
import { retryAfterWholeSeconds } from '../routes/routeProfileClient';
import { plainCountPhrase } from '../format';
import { scheduleDayUrl, type ScheduleDayResponse } from './scheduleDayApi';

/*
 * The person-started loader of a route's full timetable: each bus seen on the route is
 * one lookup of its whole day on the schedule service (up to four calls to that server),
 * so the run is deliberately slow and small. One bus at a time, in order; a bus already
 * recorded for the date is skipped; at most TIMETABLE_LOAD_CAP buses a press; a 429 is
 * waited out (its `Retry-After`, counted down a second at a time) and the same bus asked
 * again; it can be cancelled; it never starts by itself and never crawls. The sequencing
 * is the route-details loader's own (`runProfileLoader`), with the bus day as the lookup.
 */

/** The most buses one press looks up: 20 buses × up to 4 calls is at most 80 calls. */
export const TIMETABLE_LOAD_CAP = 20;
const DEFAULT_RETRY_SECONDS = 30;

/** The buses one press looks up: seen on the route, no recorded day, not answered this visit. */
export function busesToLoad(
  busesOnRoute: readonly string[],
  busesWithDay: readonly string[],
  answered: ReadonlySet<string>,
): readonly string[] {
  const recorded = new Set(busesWithDay);
  return busesOnRoute
    .filter((bus) => !recorded.has(bus) && !answered.has(bus))
    .slice(0, TIMETABLE_LOAD_CAP);
}

/** One bus's day through the schedule-day endpoint, as an outcome; it never throws. */
export async function lookupBusDay(
  routeName: string,
  registration: string,
  signal: AbortSignal,
): Promise<LookupOutcome> {
  const url = scheduleDayUrl(registration, routeName);
  if (url === null) return { kind: 'failed' };
  try {
    const response = await fetch(url, { signal, cache: 'no-store' });
    if (response.status === 429) {
      const seconds = retryAfterWholeSeconds(response.headers.get('retry-after'));
      return { kind: 'limited', retryAfterSeconds: seconds ?? DEFAULT_RETRY_SECONDS };
    }
    if (!response.ok) return { kind: 'failed' };
    const body = (await response.json()) as ScheduleDayResponse;
    if (body.status === 'ok') return { kind: 'loaded' };
    return body.reason === 'no_schedule' ? { kind: 'empty' } : { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

/** Runs the lookups over at most TIMETABLE_LOAD_CAP buses; resolves with the final progress. */
export function runTimetableLoader(
  buses: readonly string[],
  deps: LoaderDeps,
  signal: AbortSignal,
): Promise<LoaderProgress> {
  return runProfileLoader(buses.slice(0, TIMETABLE_LOAD_CAP), deps, signal);
}

const loadedOf = (p: LoaderProgress): number => p.looked - p.empty - p.failed;

function countLine(p: LoaderProgress): string {
  return `${loadedOf(p)} of ${p.total} loaded · ${p.total - p.looked} remain`;
}

function endLine(p: LoaderProgress): string {
  const parts = [`${loadedOf(p)} of ${p.total} loaded`];
  if (p.empty > 0) parts.push(`${p.empty} had no timetable`);
  if (p.failed > 0) parts.push(`${p.failed} could not be read`);
  return parts.join(' · ');
}

/** The run in words, for one `role="status"` line. */
export function timetableProgressSentence(p: LoaderProgress): string {
  switch (p.phase) {
    case 'idle':
      return '';
    case 'paused':
      return `Paused at the lookup limit; resuming in ${plainCountPhrase(p.pausedSeconds ?? 0, 'second', 'seconds')} · ${countLine(p)}`;
    case 'cancelled':
      return `Cancelled: ${endLine(p)}.`;
    case 'done':
      return `Done: ${endLine(p)}. The chart updates on its next refresh.`;
    default:
      return countLine(p);
  }
}

/** The button's words; its cost is in its `title`. */
export function loadTimetableButtonLabel(): string {
  return 'Load this route’s full timetable';
}

/** The button's `title`: what a press costs. */
export function loadTimetableButtonTitle(buses: number): string {
  return `Looks up ${plainCountPhrase(buses, 'bus', 'buses')} on the schedule service: one bus at a time, up to 4 calls each, at most ${TIMETABLE_LOAD_CAP} buses a press.`;
}

/** What is left to load once no run is going; null when no bus was seen on the route. */
export function timetableRemainingLine(left: number, seen: number): string | null {
  if (seen === 0) return null;
  if (left === 0) return 'Every bus seen on this route has its timetable loaded.';
  return `${left} of ${plainCountPhrase(seen, 'bus', 'buses')} still to load; a press loads up to ${TIMETABLE_LOAD_CAP}.`;
}
