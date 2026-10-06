/**
 * The network Trends page's list of units for one metric: a sparkline, the
 * change over a week and over four weeks, sortable by either change and
 * capped until the reader asks for every row. Built from one batch response.
 *
 * The batch response states the week's change but not its direction (its
 * `direction` is the four-week one when there is one), so the week column
 * prints a signed change and only the four-week column prints a word.
 */
import type { SortDirection } from '../tableSort';
import type { DepotTrendsResponse, TrendRow } from './api';
import { FOUR_WEEK_DAYS, WEEK_DAYS, type TrendUnit } from './trend';
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
}

export const TREND_ROW_CAP = 25;
const NO_VALUE = '—';
const MINUS = '−';

const UNIT_WORDS: Readonly<Record<TrendUnit, string>> = {
  percentage_points: 'percentage points',
  points: 'points',
  buses: 'buses',
};

const DECIMALS: Readonly<Record<TrendUnit, number>> = {
  percentage_points: 1,
  points: 1,
  buses: 0,
};

/** "+2.1", "−1.2", "0.0", "+3": the change as the trend summary rounded it. */
function signed(change: number, unit: TrendUnit): string {
  const text = Math.abs(change).toFixed(DECIMALS[unit]);
  if (Number(text) === 0) return text;
  return `${change > 0 ? '+' : MINUS}${text}`;
}

function fourWeeksText(row: TrendRow, unit: TrendUnit): string {
  const trend = row.trend;
  if (trend === null) return NO_VALUE;
  if (trend.fourWeeks === null) return 'too little history';
  if (trend.direction === 'steady') return `steady, ${signed(trend.fourWeeks, unit)}`;
  return `${trend.direction} ${Math.abs(trend.fourWeeks).toFixed(DECIMALS[unit])}`;
}

function sparkLabel(row: TrendRow, metricLabel: string): string {
  const where = `${metricLabel} at ${row.name}`;
  if (row.trend === null) return `${where}: no MODELLED trend yet`;
  return `${where}, ${row.trend.sentence}, ending on the live value`;
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
    sparkLabel: sparkLabel(row, metric.label),
    week: row.trend?.week ?? null,
    fourWeeks: row.trend?.fourWeeks ?? null,
    weekText: row.trend === null ? NO_VALUE : signed(row.trend.week, trendUnit),
    fourWeeksText: fourWeeksText(row, trendUnit),
  }));
}

export interface TrendColumnHeaders {
  readonly spark: string;
  readonly week: string;
  readonly fourWeeks: string;
}

export function trendColumnHeaders(unit: TrendUnit, days: number): TrendColumnHeaders {
  return {
    spark: `Last ${days} days, MODELLED`,
    week: `Change over ${WEEK_DAYS} days, ${UNIT_WORDS[unit]}, MODELLED`,
    fourWeeks: `Over ${FOUR_WEEK_DAYS / WEEK_DAYS} weeks, ${UNIT_WORDS[unit]}, MODELLED`,
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

export function capTrendRows<T>(rows: readonly T[], expanded: boolean): CappedRows<T> {
  if (expanded || rows.length <= TREND_ROW_CAP) return { shown: rows, hidden: 0 };
  return { shown: rows.slice(0, TREND_ROW_CAP), hidden: rows.length - TREND_ROW_CAP };
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
    `MODELLED trends of ${metricLabel.toLowerCase()}: ${count}, ` +
    `by ${SORT_WORDS[sort.key]}, ${orderWords(sort)}`
  );
}
