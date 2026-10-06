import type { DepotBusRow } from '@/models/depotLive';
import type { BusOpState } from '../types';
import { locateBus } from './location';
import type { LocatedBus, OutshedRow, OutshedState, OutshedSummary, Yard } from './types';

/** Depots tolerate a short push-out; ten minutes is the usual shed turnaround. */
export const OUTSHED_GRACE_MIN = 10;
/**
 * An `actualStart` counts only this close to its scheduled start. The feed
 * leaves old values in place, so a stamp days away is residue, not evidence.
 */
export const ACTUAL_START_WINDOW_MIN = { before: 120, after: 360 } as const;
/** Beyond this lateness the figure is not reported (the departure still counts). */
export const MAX_PLAUSIBLE_DELAY_MIN = 180;

const MS_PER_MIN = 60_000;
const DATE_PREFIX_LENGTH = 10;

function emptyCounts(): Record<OutshedState, number> {
  return { upcoming: 0, due: 0, departed: 0, overdue: 0, ended: 0, unknown: 0 };
}

/** Feed times carry a `Z` but are wall-clock; they are only compared with each other. */
function parseMs(iso: string | null): number {
  return iso === null ? NaN : Date.parse(iso);
}

/** True when the row's scheduled start falls on the feed's calendar date. */
export function isScheduledForFeedDate(row: DepotBusRow, feedNow: string | null): boolean {
  if (row.scheduledStart === null || feedNow === null) return false;
  return (
    row.scheduledStart.slice(0, DATE_PREFIX_LENGTH) === feedNow.slice(0, DATE_PREFIX_LENGTH)
  );
}

function result(
  row: DepotBusRow,
  scheduledStart: string,
  state: OutshedState,
  extra: Partial<Pick<OutshedRow, 'minutesLate' | 'minutesOverdue' | 'evidence'>> = {},
): OutshedRow {
  return {
    registrationNumber: row.registrationNumber,
    routeName: row.routeName,
    journeyCode: row.journeyCode,
    scheduledStart,
    scheduledEnd: row.scheduledEnd,
    state,
    minutesLate: null,
    minutesOverdue: null,
    evidence: 'none',
    ...extra,
  };
}

/**
 * Where one scheduled departure stands. Rules run in order, first match wins;
 * null when the row has no schedule for the feed date.
 *
 *  1. `scheduledEnd` earlier than feedNow: `ended`
 *  2. a credible `actualStart`: `departed` (evidence `actual_time`)
 *  3. `scheduledStart` later than feedNow: `upcoming`, whether or not the bus is
 *     dark or located, so a manager sees an upcoming run whose bus is silent
 *  4. bus is `dark`, or its location is `unknown`: `unknown`
 *  5. bus is `in_service`/`on_road`, or located `away`/`at_other_yard`:
 *     `departed` (evidence `left_yard`)
 *  6. within OUTSHED_GRACE_MIN of `scheduledStart`: `due`
 *  7. otherwise: `overdue`, with `minutesOverdue` = whole minutes past the
 *     scheduled start (grace period included, not subtracted)
 *
 * A dark bus's position is a stale last fix, so it never proves a departure:
 * only a credible actual time can (rule 2).
 */
export function classifyOutshed(
  row: DepotBusRow,
  state: BusOpState,
  located: LocatedBus,
  feedNow: string,
): OutshedRow | null {
  if (!isScheduledForFeedDate(row, feedNow)) return null;
  const scheduledStart = row.scheduledStart as string;
  const start = parseMs(scheduledStart);
  const now = parseMs(feedNow);
  if (Number.isNaN(start) || Number.isNaN(now)) return null;
  const make = (s: OutshedState, extra?: Parameters<typeof result>[3]) =>
    result(row, scheduledStart, s, extra);

  const end = parseMs(row.scheduledEnd);
  if (!Number.isNaN(end) && end < now) return make('ended');

  const actual = parseMs(row.actualStart);
  if (!Number.isNaN(actual) && actual <= now) {
    const lateMin = Math.round((actual - start) / MS_PER_MIN);
    if (lateMin >= -ACTUAL_START_WINDOW_MIN.before && lateMin <= ACTUAL_START_WINDOW_MIN.after) {
      return make('departed', {
        evidence: 'actual_time',
        minutesLate: lateMin > MAX_PLAUSIBLE_DELAY_MIN ? null : lateMin,
      });
    }
  }

  if (start > now) return make('upcoming');

  if (state === 'dark' || located.location === 'unknown') return make('unknown');

  const isOut =
    state === 'in_service' ||
    state === 'on_road' ||
    located.location === 'away' ||
    located.location === 'at_other_yard';
  if (isOut) return make('departed', { evidence: 'left_yard' });

  // Whole minutes past the scheduled start, grace period included.
  const minutesPast = Math.floor((now - start) / MS_PER_MIN);
  if (minutesPast <= OUTSHED_GRACE_MIN) return make('due');
  return make('overdue', { minutesOverdue: minutesPast });
}

function compareRows(a: OutshedRow, b: OutshedRow): number {
  const key = (r: OutshedRow): readonly string[] => [
    r.scheduledStart,
    r.registrationNumber,
    r.journeyCode ?? '',
  ];
  const ka = key(a);
  const kb = key(b);
  for (let i = 0; i < ka.length; i += 1) {
    if (ka[i]! < kb[i]!) return -1;
    if (ka[i]! > kb[i]!) return 1;
  }
  return 0;
}

/**
 * Outshedding for one depot's rows. `stateOf` is supplied by the caller (the
 * bus-state classifier lives elsewhere). `coverage.of` is the rows passed in.
 */
export function summariseOutshed(
  rows: readonly DepotBusRow[],
  yards: ReadonlyMap<string, Yard>,
  feedNow: string | null,
  stateOf: (row: DepotBusRow) => BusOpState,
): OutshedSummary {
  const counts = emptyCounts();
  if (feedNow === null) return { rows: [], counts, coverage: { n: 0, of: rows.length } };

  const classified: OutshedRow[] = [];
  for (const row of rows) {
    const outshed = classifyOutshed(row, stateOf(row), locateBus(row, yards), feedNow);
    if (outshed) classified.push(outshed);
  }
  classified.sort(compareRows);
  for (const outshed of classified) counts[outshed.state] += 1;

  return { rows: classified, counts, coverage: { n: classified.length, of: rows.length } };
}
