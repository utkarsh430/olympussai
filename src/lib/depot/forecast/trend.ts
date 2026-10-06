/**
 * Trend summaries: how far a metric has moved over the last week and the
 * last four weeks (28 days, so the same weekdays are compared), in its own
 * unit, and the sentence that stands in for a sparkline ("up 2.1 points over
 * 4 weeks"). A move reads as steady while it is inside the series' own
 * variation at that lag, so noise is never reported as a direction. Pure.
 */
import type { MetricKey, SeriesPoint } from '../sim/types';
import {
  higherIsBetter,
  metricKindOf,
  MIN_STEADY_CHANGES,
  seriesRulesOf,
  STEADY_BAND,
  STEADY_QUANTILE,
  type MetricKind,
} from './config';
import { nearestRankQuantile } from './band';
import { insufficientHistory, prepareSeries } from './series';
import type { InsufficientHistory, SeriesInputReason, TrendUnit } from './types';
import { roundHalfAwayFromZero } from '@/lib/depot/stats/rounding';

export type TrendDirection = 'up' | 'down' | 'steady';
export type { TrendUnit } from './types';

export const WEEK_DAYS = 7;
/** Four whole weeks, so a Monday is compared with a Monday. */
export const FOUR_WEEK_DAYS = 28;

export interface TrendChange {
  readonly days: number;
  /** The point `days` before the latest. */
  readonly from: SeriesPoint;
  /** Latest minus `from`, in `unit`, rounded as shown in the sentence. */
  readonly change: number;
  /**
   * In `unit`: a change smaller than this reads as steady. The 80th
   * percentile of the series' own absolute changes at this lag, never below
   * the per-kind floor `STEADY_BAND`.
   */
  readonly steadyWithin: number;
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
  /** Null when the contiguous history is shorter than 29 days. */
  readonly fourWeeks: TrendChange | null;
  /** The text equivalent: the four-week sentence when there is one, else the week's. */
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

/** The steady threshold at lag `days`, in the display unit; see `TrendChange.steadyWithin`. */
function steadyWithin(run: readonly SeriesPoint[], days: number, kind: MetricKind): number {
  const { scale } = FORMAT[kind];
  const changes = run
    .slice(days)
    .map((p, i) => Math.abs(p.value - (run[i] as SeriesPoint).value) * scale);
  if (changes.length < MIN_STEADY_CHANGES) return STEADY_BAND[kind];
  return Math.max(STEADY_BAND[kind], nearestRankQuantile(changes, STEADY_QUANTILE));
}

function directionOf(change: number, threshold: number): TrendDirection {
  if (Math.abs(change) < threshold) return 'steady';
  return change > 0 ? 'up' : 'down';
}

function sentenceFor(
  days: number,
  change: number,
  direction: TrendDirection,
  format: UnitFormat,
): string {
  const span = days === FOUR_WEEK_DAYS ? 'over 4 weeks' : `over ${days} days`;
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
  const change = roundHalfAwayFromZero((latest.value - from.value) * format.scale, format.decimals);
  const threshold = steadyWithin(run, days, kind);
  const direction = directionOf(change, threshold);
  const sentence = sentenceFor(days, change, direction, format);
  return { days, from, change, steadyWithin: threshold, direction, sentence };
}

/**
 * Summarises the contiguous run of days ending on the latest date (the same
 * gap rule as the forecast: a missing day ends the run). Needs at least
 * eight such days for the week; the four weeks need 29.
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
  const fourWeeks = changeOver(run, FOUR_WEEK_DAYS, kind);
  return {
    status: 'ok',
    summary: {
      metric,
      kind,
      unit: FORMAT[kind].unit,
      higherIsBetter: higherIsBetter(metric),
      latest,
      week,
      fourWeeks,
      sentence: (fourWeeks ?? week).sentence,
      historyDays: run.length,
    },
  };
}
