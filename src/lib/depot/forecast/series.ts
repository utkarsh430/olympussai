/**
 * Turns a raw daily series into the run a forecast or trend may use.
 *
 * The rule for gaps: points are sorted by date, and only the contiguous run
 * of days ending on the latest date counts. A missing day ends the run, so
 * everything before it is ignored rather than bridged by an invented value.
 * Too short a run then reads as insufficient history, never as a silent guess.
 */
import type { SeriesPoint } from '../sim/types';
import type { ValidRange } from './config';
import type { SeriesInputReason } from './types';

const MS_PER_DAY = 86_400_000;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Milliseconds at UTC midnight for a real YYYY-MM-DD date, or null. */
export function parseDay(date: string): number | null {
  const match = ISO_DAY.exec(date);
  if (match === null) return null;
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== date) return null;
  return time;
}

/** The YYYY-MM-DD date `days` after a valid `date`. */
export function addDays(date: string, days: number): string {
  const time = parseDay(date);
  if (time === null) throw new RangeError(`Not a valid YYYY-MM-DD date: "${date}"`);
  return new Date(time + days * MS_PER_DAY).toISOString().slice(0, 10);
}

export type PreparedSeries =
  | { readonly ok: true; readonly run: readonly SeriesPoint[] }
  | { readonly ok: false; readonly reason: SeriesInputReason };

function invalidReason(point: SeriesPoint, range: ValidRange): SeriesInputReason | null {
  if (parseDay(point.date) === null) return 'invalid_date';
  if (!Number.isFinite(point.value)) return 'non_finite_value';
  if (point.value < range.min || point.value > range.max) return 'out_of_range';
  return null;
}

/**
 * Validates every point, then returns a sorted copy of the contiguous run
 * ending on the latest date (empty for an empty series). The input is not
 * touched. A bad date, a non-finite or out-of-range value, or two points on
 * one date make the whole series invalid: there is no right way to pick.
 */
export function prepareSeries(
  series: readonly SeriesPoint[],
  range: ValidRange,
): PreparedSeries {
  for (const point of series) {
    const reason = invalidReason(point, range);
    if (reason !== null) return { ok: false, reason };
  }
  // ISO dates sort correctly as strings.
  const sorted = [...series].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let start = sorted.length - 1;
  for (let i = sorted.length - 1; i > 0; i -= 1) {
    const day = parseDay((sorted[i] as SeriesPoint).date) as number;
    const previous = parseDay((sorted[i - 1] as SeriesPoint).date) as number;
    if (day === previous) return { ok: false, reason: 'duplicate_date' };
    if (day - previous === MS_PER_DAY && start === i) start = i - 1;
  }
  return { ok: true, run: sorted.slice(Math.max(start, 0)) };
}
