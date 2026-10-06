import { formatCount } from '@/lib/depot/format';
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
  return row.minutesLate > 0 ? `${row.minutesLate} min late` : `${-row.minutesLate} min early`;
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
        : { minutes: row.minutesOverdue, minutesText: `${row.minutesOverdue} min overdue` };
    case 'due':
      return until === null
        ? { minutes: null, minutesText: 'Within grace' }
        : { minutes: -until, minutesText: `${-until} min since schedule` };
    case 'upcoming':
      return until === null
        ? { minutes: null, minutesText: DASH }
        : { minutes: until, minutesText: `in ${until} min` };
    case 'departed':
      return { minutes: row.minutesLate, minutesText: departedText(row) };
    case 'ended':
    case 'unknown':
      return { minutes: null, minutesText: DASH };
  }
}

/** Overdue first, then due, upcoming, unknown, departed, ended; by scheduled time within each. */
export function buildTracker(rows: readonly OutshedRow[], feedNow: string | null): TrackerRow[] {
  return [...rows]
    .sort(
      (a, b) =>
        OUTSHED_ORDER.indexOf(a.state) - OUTSHED_ORDER.indexOf(b.state) ||
        a.scheduledStart.localeCompare(b.scheduledStart) ||
        a.registrationNumber.localeCompare(b.registrationNumber, 'en'),
    )
    .map((row) => ({
      key: `${row.registrationNumber}:${row.scheduledStart}`,
      registrationNumber: row.registrationNumber,
      routeName: row.routeName,
      journeyCode: row.journeyCode,
      scheduledStart: row.scheduledStart,
      state: row.state,
      label: OUTSHED_STATE_LABEL[row.state],
      ...minutesFor(row, feedNow),
    }));
}

/** "31 of 142 buses carry a schedule for today." */
export function coverageSentence(coverage: Coverage): string {
  if (coverage.of === 0) return 'This depot has no buses, so none carries a schedule for today.';
  const noun = coverage.of === 1 ? 'bus' : 'buses';
  const verb = coverage.n === 1 || coverage.of === 1 ? 'carries' : 'carry';
  return `${formatCount(coverage.n)} of ${formatCount(coverage.of)} ${noun} ${verb} a schedule for today.`;
}
