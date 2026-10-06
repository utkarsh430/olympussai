import { formatCount, formatDurationMinutes, formatPlainDate } from '@/lib/depot/format';
import type { OutshedRow, OutshedState } from '@/lib/depot/infer/types';
import type { Coverage } from '@/lib/depot/types';
import type { TrackerRow } from './cockpitTypes';

/** The outshedding tracker: today's departures in urgency order, and how much they cover. */

export const OUTSHED_STATE_LABEL: Readonly<Record<OutshedState, string>> = {
  overdue: 'Overdue',
  due: 'Due now',
  upcoming: 'Upcoming',
  unknown: 'Unknown',
  departed: 'Departed',
  ended: 'Window ended',
};
const OUTSHED_ORDER: readonly OutshedState[] = [
  'overdue',
  'due',
  'upcoming',
  'unknown',
  'departed',
  'ended',
];
const DASH = '—';
const MS_PER_MIN = 60_000;

/** Minutes from the feed clock to a feed timestamp; both carry the same nominal zone. */
function minutesFromNow(feedNow: string | null, at: string): number | null {
  if (feedNow === null) return null;
  const diff = Date.parse(at) - Date.parse(feedNow);
  return Number.isFinite(diff) ? Math.round(diff / MS_PER_MIN) : null;
}

function departedText(row: OutshedRow): string {
  if (row.minutesLate === null) {
    return row.evidence === 'left_yard' ? 'Left the yard; no departure time' : DASH;
  }
  if (row.minutesLate === 0) return 'On time';
  return row.minutesLate > 0
    ? `${formatDurationMinutes(row.minutesLate)} late`
    : `${formatDurationMinutes(-row.minutesLate)} early`;
}

function minutesFor(
  row: OutshedRow,
  feedNow: string | null,
): Pick<TrackerRow, 'minutes' | 'minutesText'> {
  const until = minutesFromNow(feedNow, row.scheduledStart);
  switch (row.state) {
    case 'overdue':
      return row.minutesOverdue === null
        ? { minutes: null, minutesText: DASH }
        : { minutes: row.minutesOverdue, minutesText: `${formatDurationMinutes(row.minutesOverdue)} overdue` };
    case 'due':
      return until === null
        ? { minutes: null, minutesText: 'Within grace' }
        : { minutes: -until, minutesText: `${formatDurationMinutes(-until)} since schedule` };
    case 'upcoming':
      return until === null
        ? { minutes: null, minutesText: DASH }
        : { minutes: until, minutesText: `in ${formatDurationMinutes(until)}` };
    case 'departed':
      return { minutes: row.minutesLate, minutesText: departedText(row) };
    case 'ended':
    case 'unknown':
      return { minutes: null, minutesText: DASH };
  }
}

/** Most overdue first: an unknown overdue time sorts after every known one. */
function compareOverdue(a: TrackerRow, b: TrackerRow): number {
  if (a.minutes === b.minutes) return 0;
  if (a.minutes === null) return 1;
  if (b.minutes === null) return -1;
  return b.minutes - a.minutes;
}

function compareRows(a: TrackerRow, b: TrackerRow): number {
  const byState = OUTSHED_ORDER.indexOf(a.state) - OUTSHED_ORDER.indexOf(b.state);
  if (byState !== 0) return byState;
  return (
    (a.state === 'overdue' ? compareOverdue(a, b) : 0) ||
    a.scheduledStart.localeCompare(b.scheduledStart) ||
    a.registrationNumber.localeCompare(b.registrationNumber, 'en')
  );
}

/** Overdue (most overdue first), due, upcoming, unknown, departed, ended; by time within each. */
export function buildTracker(rows: readonly OutshedRow[], feedNow: string | null): TrackerRow[] {
  return rows
    .map((row) => ({
      key: `${row.registrationNumber}:${row.scheduledStart}`,
      registrationNumber: row.registrationNumber,
      routeName: row.routeName,
      journeyCode: row.journeyCode,
      scheduledStart: row.scheduledStart,
      state: row.state,
      label: OUTSHED_STATE_LABEL[row.state],
      ...minutesFor(row, feedNow),
    }))
    .sort(compareRows);
}

/** Below this share of the fleet carrying a schedule, the tracker says who it cannot see. */
export const THIN_SCHEDULE_SHARE = 0.5;
const FEED_DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}/;

/** YYYY-MM-DD as written in the feed's own clock; null without one. */
export function feedDateOf(feedNow: string | null): string | null {
  return feedNow === null ? null : (FEED_DATE_PATTERN.exec(feedNow)?.[0] ?? null);
}

function forFeedDate(feedDate: string | null): string {
  return feedDate === null ? 'for the feed date' : `for the feed date, ${formatPlainDate(feedDate)}`;
}

/**
 * "31 of 142 buses carry a schedule for the feed date, 6 Oct 2026." When few do,
 * a second sentence says the rest are invisible here, so a short list is never
 * read as all of the depot's departures.
 */
export function coverageSentence(coverage: Coverage, feedDate: string | null): string {
  if (coverage.of === 0) {
    return 'This depot has no buses, so none carries a schedule for the feed date.';
  }
  const noun = coverage.of === 1 ? 'bus' : 'buses';
  const verb = coverage.n === 1 || coverage.of === 1 ? 'carries' : 'carry';
  const first = `${formatCount(coverage.n)} of ${formatCount(coverage.of)} ${noun} ${verb} a schedule ${forFeedDate(feedDate)}.`;
  const rest = coverage.of - coverage.n;
  if (coverage.n === 0 || coverage.n / coverage.of >= THIN_SCHEDULE_SHARE) return first;
  return `${first} Only these buses can be tracked: the other ${formatCount(rest)} ${
    rest === 1 ? 'carries' : 'carry'
  } no schedule for that date, so their departures are not shown.`;
}

/** The tracker's empty state. */
export function noSchedulesSentence(feedDate: string | null): string {
  return `No bus carries a schedule ${forFeedDate(feedDate)}, so there are no departures to track.`;
}

/**
 * When every tracked departure's window has ended there is nothing to act on: one line
 * says so and the table waits behind "Show all". Null while any row still needs a look.
 */
export function endedSummary(rows: readonly Pick<TrackerRow, 'state'>[]): string | null {
  if (rows.length === 0 || rows.some((row) => row.state !== 'ended')) return null;
  return rows.length === 1
    ? 'The one tracked departure is past its window.'
    : `All ${formatCount(rows.length)} tracked departures are past their window.`;
}
