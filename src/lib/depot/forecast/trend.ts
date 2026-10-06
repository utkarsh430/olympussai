/**
 * Trend summaries: how far a metric has moved over the last week and month,
 * in its own unit, and the sentence that stands in for a sparkline
 * ("up 2.1 points over 30 days"). Small moves read as steady so day-to-day
 * noise is never reported as a direction. Pure, like the forecasts.
 */
import type { MetricKey, SeriesPoint } from '../sim/types';
import { higherIsBetter, metricKindOf, seriesRulesOf, STEADY_BAND, type MetricKind } from './config';
import { insufficientHistory, prepareSeries } from './series';
import type { InsufficientHistory, SeriesInputReason } from './types';

export type TrendDirection = 'up' | 'down' | 'steady';
export type TrendUnit = 'percentage_points' | 'points' | 'buses';

export const WEEK_DAYS = 7;
export const MONTH_DAYS = 30;

export interface TrendChange {
  readonly days: number;
  /** The point `days` before the latest. */
  readonly from: SeriesPoint;
  /** Latest minus `from`, in `unit`, rounded as shown in the sentence. */
  readonly change: number;
  readonly direction: TrendDirection;
  readonly sentence: string;
}

export interface TrendSummary {
  readonly metric: MetricKey;
  readonly kind: MetricKind;
  readonly unit: TrendUnit;
  readonly higherIsBetter: boolean;
  readonly latest: SeriesPoint;
  readonly week: TrendChange;
  /** Null when the contiguous history is shorter than 31 days. */
  readonly month: TrendChange | null;
  /** The text equivalent: the month's sentence when there is one, else the week's. */
  readonly sentence: string;
  /** Length of the contiguous run of days ending on the latest date. */
  readonly historyDays: number;
}

export type TrendResult =
  | { readonly status: 'ok'; readonly summary: TrendSummary }
  | InsufficientHistory
  | { readonly status: 'invalid_input'; readonly reason: SeriesInputReason };

interface UnitFormat {
  readonly unit: TrendUnit;
  readonly words: string;
  /** Converts a raw difference into the unit. */
  readonly scale: number;
  readonly decimals: number;
}

const FORMAT: Readonly<Record<MetricKind, UnitFormat>> = {
  rate: { unit: 'percentage_points', words: 'percentage points', scale: 100, decimals: 1 },
  index: { unit: 'points', words: 'points', scale: 1, decimals: 1 },
  count: { unit: 'buses', words: 'buses', scale: 1, decimals: 0 },
};

/**
 * Rounds half away from zero, symmetric for rises and falls. The first pass
 * to six places strips binary noise, so 0.805 - 0.8 (0.50000000000000044 pp)
 * and its mirror both round the same way.
 */
function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const cleaned = Number((Math.abs(value) * factor).toFixed(6));
  const rounded = (Math.sign(value) * Math.round(cleaned)) / factor;
  return rounded === 0 ? 0 : rounded;
}

function directionOf(change: number, kind: MetricKind): TrendDirection {
  if (Math.abs(change) < STEADY_BAND[kind]) return 'steady';
  return change > 0 ? 'up' : 'down';
}

function sentenceFor(
  days: number,
  change: number,
  direction: TrendDirection,
  format: UnitFormat,
): string {
  const span = `over ${days} days`;
  if (direction === 'steady') return `steady ${span}`;
  return `${direction} ${Math.abs(change).toFixed(format.decimals)} ${format.words} ${span}`;
}

/** The move from the point `days` before the latest; null when the run is too short. */
function changeOver(
  run: readonly SeriesPoint[],
  days: number,
  kind: MetricKind,
): TrendChange | null {
  const latest = run.at(-1);
  const from = run.at(-1 - days);
  if (latest === undefined || from === undefined) return null;
  const format = FORMAT[kind];
  const change = roundTo((latest.value - from.value) * format.scale, format.decimals);
  const direction = directionOf(change, kind);
  return { days, from, change, direction, sentence: sentenceFor(days, change, direction, format) };
}

/**
 * Summarises the contiguous run of days ending on the latest date (the same
 * gap rule as the forecast: a missing day ends the run). Needs at least
 * eight such days for the week; the month needs 31.
 */
export function summariseTrend(series: readonly SeriesPoint[], metric: MetricKey): TrendResult {
  const prepared = prepareSeries(series, seriesRulesOf(metric));
  if (!prepared.ok) return { status: 'invalid_input', reason: prepared.reason };
  const { run } = prepared;
  const kind = metricKindOf(metric);
  const latest = run.at(-1);
  const week = changeOver(run, WEEK_DAYS, kind);
  if (latest === undefined || week === null) {
    return insufficientHistory(prepared, WEEK_DAYS + 1);
  }
  const month = changeOver(run, MONTH_DAYS, kind);
  return {
    status: 'ok',
    summary: {
      metric,
      kind,
      unit: FORMAT[kind].unit,
      higherIsBetter: higherIsBetter(metric),
      latest,
      week,
      month,
      sentence: (month ?? week).sentence,
      historyDays: run.length,
    },
  };
}
