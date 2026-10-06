/**
 * The network Trends page's list of units for one metric: a sparkline, the
 * change over a week and over four weeks, sortable by either change and paged
 * at 25. Built from one batch response.
 *
 * The batch response states the week's change but not its direction (its
 * `direction` is the four-week one when there is one). The row carries its whole
 * series and the date it ends on, so the week's direction word is computed here
 * with the same function and dead band the four-week word comes from
 * (`summariseTrend`); it is printed only when that recomputation agrees with the
 * batch's own week change, so a word never contradicts the figure beside it.
 */
import { MINUS } from '@/lib/depot/format';
import type { SortDirection } from '../tableSort';
import type { DepotTrendsResponse, TrendRow } from './api';
import type { MetricKey, SeriesPoint } from '../sim/types';
import { addDays } from './series';
import { FOUR_WEEK_DAYS, summariseTrend, WEEK_DAYS, type TrendDirection, type TrendUnit } from './trend';
import { depotTrendsPath, trendsHref } from './trendsPageModel';

export type TrendSortKey = 'name' | 'week' | 'fourWeeks';

export interface TrendSort {
  readonly key: TrendSortKey;
  readonly direction: SortDirection;
}

export interface TrendTableRow {
  readonly id: string;
  readonly name: string;
  readonly href: string;
  readonly values: readonly number[];
  readonly sparkLabel: string;
  readonly week: number | null;
  readonly fourWeeks: number | null;
  readonly weekText: string;
  readonly fourWeeksText: string;
  /** The change alone, "+1.0" or "−1.1" (units are in the column header); "—" when none. */
  readonly weekSigned: string;
  readonly fourWeeksSigned: string;
  /** UP, STEADY or DOWN by the shared dead band, "TOO SHORT" or "—". */
  readonly weekWord: string;
  readonly fourWeeksWord: string;
}

export const TREND_ROW_CAP = 25;
const NO_VALUE = '—';

const DECIMALS: Readonly<Record<TrendUnit, number>> = {
  percentage_points: 1,
  points: 1,
  buses: 0,
};

/** "+2.1", "−1.2", "0.0", "+3": the change as the trend summary rounded it. */
function signedChange(change: number, unit: TrendUnit): string {
  const text = Math.abs(change).toFixed(DECIMALS[unit]);
  if (Number(text) === 0) return text;
  return `${change > 0 ? '+' : MINUS}${text}`;
}

/** The series of a batch row, with its dates counted back from the date it ends on. */
function seriesOf(row: TrendRow): readonly SeriesPoint[] {
  const last = row.values.length - 1;
  return row.values.map((value, index) => ({ date: addDays(row.endDate, index - last), value }));
}

/** The week's direction by the shared dead-band rule; null when it cannot be established. */
export function weekDirection(row: TrendRow, metric: MetricKey): TrendDirection | null {
  if (row.trend === null || row.values.length === 0 || row.endDate === '') return null;
  const result = summariseTrend(seriesOf(row), metric);
  if (result.status !== 'ok') return null;
  return result.summary.week.change === row.trend.week ? result.summary.week.direction : null;
}

function weekText(row: TrendRow, unit: TrendUnit, metric: MetricKey): string {
  const trend = row.trend;
  if (trend === null) return NO_VALUE;
  const direction = weekDirection(row, metric);
  if (direction === null) return signedChange(trend.week, unit);
  if (direction === 'steady') return `steady, ${signedChange(trend.week, unit)}`;
  return `${direction} ${Math.abs(trend.week).toFixed(DECIMALS[unit])}`;
}

function fourWeeksText(row: TrendRow, unit: TrendUnit): string {
  const trend = row.trend;
  if (trend === null) return NO_VALUE;
  if (trend.fourWeeks === null) return 'too little history';
  if (trend.direction === 'steady') return `steady, ${signedChange(trend.fourWeeks, unit)}`;
  return `${trend.direction} ${Math.abs(trend.fourWeeks).toFixed(DECIMALS[unit])}`;
}

const WORD: Readonly<Record<TrendDirection, string>> = { up: 'UP', steady: 'STEADY', down: 'DOWN' };
const TOO_SHORT_WORD = 'TOO SHORT';

function weekSigned(row: TrendRow, unit: TrendUnit): string {
  return row.trend === null ? NO_VALUE : signedChange(row.trend.week, unit);
}

function fourWeeksSigned(row: TrendRow, unit: TrendUnit): string {
  return row.trend?.fourWeeks == null ? NO_VALUE : signedChange(row.trend.fourWeeks, unit);
}

function weekWord(row: TrendRow, metric: MetricKey): string {
  const direction = weekDirection(row, metric);
  return direction === null ? NO_VALUE : WORD[direction];
}

function fourWeeksWord(row: TrendRow): string {
  if (row.trend === null) return NO_VALUE;
  return row.trend.fourWeeks === null ? TOO_SHORT_WORD : WORD[row.trend.direction];
}

/** A sparkline's text equivalent; a unit missing from the response has no trend. */
export function unitSparkLabel(
  metricLabel: string,
  name: string,
  trend: TrendRow['trend'],
): string {
  const where = `${metricLabel} at ${name}`;
  if (trend === null) return `${where}: no MODELLED trend yet`;
  return `${where}, ${trend.sentence}, ending on today's feed value`;
}

export function trendTableRows(
  response: Pick<DepotTrendsResponse, 'metric' | 'trendUnit' | 'units'>,
): readonly TrendTableRow[] {
  const { metric, trendUnit, units } = response;
  return units.map((row) => ({
    id: row.id,
    name: row.name,
    href: trendsHref(depotTrendsPath(row.id), metric.key),
    values: row.values,
    sparkLabel: unitSparkLabel(metric.label, row.name, row.trend),
    week: row.trend?.week ?? null,
    fourWeeks: row.trend?.fourWeeks ?? null,
    weekText: weekText(row, trendUnit, metric.key),
    fourWeeksText: fourWeeksText(row, trendUnit),
    weekSigned: weekSigned(row, trendUnit),
    fourWeeksSigned: fourWeeksSigned(row, trendUnit),
    weekWord: weekWord(row, metric.key),
    fourWeeksWord: fourWeeksWord(row),
  }));
}

export interface TrendColumnHeaders {
  readonly spark: string;
  readonly week: string;
  readonly weekWord: string;
  readonly fourWeeks: string;
  readonly fourWeeksWord: string;
  /** Printed after each signed-change header, so the cells hold bare numbers. */
  readonly unit: string;
}

const UNIT_SHORT: Readonly<Record<TrendUnit, string>> = {
  percentage_points: 'pp',
  points: 'points',
  buses: 'buses',
};

export function trendColumnHeaders(unit: TrendUnit, days: number): TrendColumnHeaders {
  const weeks = FOUR_WEEK_DAYS / WEEK_DAYS;
  return {
    spark: `Last ${days} days`,
    week: `Over ${WEEK_DAYS} days`,
    weekWord: `Trend, ${WEEK_DAYS} days`,
    fourWeeks: `Over ${weeks} weeks`,
    fourWeeksWord: `Trend, ${weeks} weeks`,
    unit: UNIT_SHORT[unit],
  };
}

/** Worst first: the steepest fall when higher is better, the steepest rise otherwise. */
export function defaultTrendSort(higherIsBetter: boolean): TrendSort {
  return { key: 'fourWeeks', direction: higherIsBetter ? 'asc' : 'desc' };
}

function byName(a: TrendTableRow, b: TrendTableRow): number {
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

/** A new array; rows without the sorted change always come last, ties go by name. */
export function sortTrendRows(
  rows: readonly TrendTableRow[],
  sort: TrendSort,
): readonly TrendTableRow[] {
  const sign = sort.direction === 'asc' ? 1 : -1;
  if (sort.key === 'name') return [...rows].sort((a, b) => sign * byName(a, b));
  const key = sort.key;
  return [...rows].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    if (x === null || y === null) return x === y ? byName(a, b) : x === null ? 1 : -1;
    return sign * (x - y) || byName(a, b);
  });
}

export interface CappedRows<T> {
  readonly shown: readonly T[];
  readonly hidden: number;
}

const SORT_WORDS: Readonly<Record<TrendSortKey, string>> = {
  name: 'name',
  week: `change over ${WEEK_DAYS} days`,
  fourWeeks: 'change over 4 weeks',
};

function orderWords(sort: TrendSort): string {
  if (sort.key === 'name') return sort.direction === 'asc' ? 'A to Z' : 'Z to A';
  return sort.direction === 'asc' ? 'lowest first' : 'highest first';
}

export function trendTableCaption(
  metricLabel: string,
  total: number,
  shown: number,
  sort: TrendSort,
): string {
  const count = shown >= total ? `all ${total} units` : `${shown} of ${total} units`;
  return (
    `Trends of ${metricLabel.toLowerCase()}: ${count}, ` +
    `by ${SORT_WORDS[sort.key]}, ${orderWords(sort)}`
  );
}
