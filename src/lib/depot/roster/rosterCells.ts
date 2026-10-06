import type { DepotBusView } from '@/lib/depot/api';
import { formatDurationMinutes, formatFeedDateTime, formatFeedTime } from '@/lib/depot/format';
import type { RosterRow } from './rosterModel';

/**
 * The roster's cell words. Durations come from `formatDurationMinutes` (never raw minutes
 * above an hour); an earlier day's schedule keeps its date and says what it is.
 */

const DASH = '—';
const UNKNOWN = 'unknown';

export interface LastHeardCell {
  readonly text: string;
  /** True for a bus unheard past the recency rule: drawn in the warning tone. */
  readonly warning: boolean;
}

/** "just now", "59 min ago", "1 h 27 min ago", "13 d 20 h ago"; "unknown" without an age. */
export function lastHeardAgo(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return UNKNOWN;
  if (minutes < 1) return 'just now';
  return `${formatDurationMinutes(minutes)} ago`;
}

/**
 * LAST HEARD is the one place the quiet is said. A bus whose report is older than the
 * recency rule keeps its state word; this cell says "not heard" in the warning tone so
 * the pair cannot be misread.
 */
export function lastHeardCell(
  bus: Pick<DepotBusView, 'gpsAgeMin' | 'notHeardMin'>,
): LastHeardCell {
  const quiet = bus.notHeardMin;
  if (quiet !== null && quiet !== undefined && Number.isFinite(quiet)) {
    return { text: `not heard ${formatDurationMinutes(quiet)}`, warning: true };
  }
  return { text: lastHeardAgo(bus.gpsAgeMin), warning: false };
}

export interface ScheduleCell {
  readonly text: string;
  readonly title: string;
  /** True when the schedule belongs to a day before the feed date. */
  readonly earlierDay: boolean;
}

/**
 * A scheduled time: the time alone on the feed date; another day with its date. A
 * schedule from an earlier day is real feed data, so it stays, muted, with its reason in
 * the title: it never looks like today's.
 */
export function scheduleCell(iso: string | null, feedNow: string | null): ScheduleCell {
  if (iso === null) return { text: DASH, title: 'No schedule in the feed', earlierDay: false };
  const full = formatFeedDateTime(iso);
  if (feedNow === null) return { text: full, title: full, earlierDay: false };
  const day = iso.slice(0, 10);
  const feedDay = feedNow.slice(0, 10);
  if (day === feedDay) return { text: formatFeedTime(iso), title: full, earlierDay: false };
  const earlierDay = day < feedDay;
  return {
    text: full,
    title: earlierDay ? `${full}; the feed still carries an earlier day's schedule for this bus` : full,
    earlierDay,
  };
}

/** The short form for a phone: "Yard", "34 km", "Other depot". */
export function locationShortText(
  bus: Pick<DepotBusView, 'location' | 'distanceFromYardKm'>,
): string {
  switch (bus.location) {
    case 'in_yard':
      return 'Yard';
    case 'at_other_yard':
      return 'Other depot';
    case 'away':
      return bus.distanceFromYardKm === null
        ? 'Away'
        : `${Math.round(bus.distanceFromYardKm).toLocaleString('en-IN')} km`;
    case 'unknown':
      return 'Unknown';
  }
}

/** RUNNING is shown only when at least one row has a value. */
export function showRunningColumn(rows: readonly RosterRow[]): boolean {
  return rows.some((row) => row.delay !== null);
}
