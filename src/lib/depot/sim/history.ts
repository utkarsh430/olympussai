/**
 * Modelled daily history. The app has no database, so a trend line is
 * generated: a mean-reverting walk with a weekly rhythm, built backwards from
 * today's real value so it can never contradict the live figure beside it.
 *
 * Every day's variation is seeded from that day's own date (plus scope and
 * metric), not from its array position. Moving the anchor forward a day
 * therefore keeps earlier dates recognisably the same.
 */
import { SeededRandom } from '@/lib/simulation/seededRandom';
import type { HistoryScope, MetricKey, SeriesAnchor, SeriesPoint } from './types';
import { seedFor } from './seed';
import { MS_PER_DAY } from '@/lib/depot/units';
import { clamp } from '@/lib/depot/stats/robust';
import { roundToDecimals } from '@/lib/depot/stats/rounding';

const MIN_DAYS = 7;
const MAX_DAYS = 180;
/** Share of the previous day's deviation that carries to the day before it. */
const REVERSION = 0.8;
/** Half-width of a day's own shock, as a share of the metric's span. */
const SHOCK_SHARE = 0.025;
/** Size of the weekly rhythm, as a share of the metric's span. */
const WEEKLY_SHARE = 0.03;
const WEEKEND_DAYS: ReadonlySet<number> = new Set([0, 6]);
const MIN_AVAILABLE_SPAN = 20;

export interface MetricRange {
  readonly min: number;
  readonly max: number;
  readonly decimals: number;
}

/** Each metric's valid range and stored precision; the forecast clips to the same range. */
export const METRIC_RANGES: Readonly<Record<MetricKey, MetricRange>> = {
  onRoadShare: { min: 0, max: 1, decimals: 4 },
  offRoadRate: { min: 0, max: 1, decimals: 4 },
  darkRate: { min: 0, max: 1, decimals: 4 },
  index: { min: 0, max: 100, decimals: 1 },
  available: { min: 0, max: Number.POSITIVE_INFINITY, decimals: 0 },
};

/**
 * The metric's own maximum, tightened by the unit's ceiling when one is given
 * (never below the metric's minimum). Throws RangeError for a ceiling that is
 * not a finite number.
 */
function upperLimit(metric: MetricKey, ceiling: number | undefined): number {
  const { min, max } = METRIC_RANGES[metric];
  if (ceiling === undefined) return max;
  if (!Number.isFinite(ceiling)) throw new RangeError(`Ceiling must be finite, got ${ceiling}`);
  return clamp(ceiling, min, max);
}

export const RATE_METRICS: ReadonlySet<MetricKey> = new Set(['onRoadShare', 'offRoadRate', 'darkRate']);
/** Keeps a rate anchored at exactly 0 or 1 from drawing a flat line. */
const MIN_RATE_SCALE = 0.05;

/**
 * The size that day-to-day variation is measured against. A rate's natural
 * spread is binomial, sqrt(p(1-p)): a 3% dark rate wobbles by fractions of a
 * point, a 50% share by several, and nothing moves much near 0 or 1. Scaling
 * by the full 0-1 range instead made a 3% rate swing from 0 to 9%.
 */
function variationScale(metric: MetricKey, anchorValue: number): number {
  if (RATE_METRICS.has(metric)) {
    return Math.max(Math.sqrt(anchorValue * (1 - anchorValue)), MIN_RATE_SCALE);
  }
  if (metric === 'available') return Math.max(anchorValue, MIN_AVAILABLE_SPAN);
  return METRIC_RANGES[metric].max - METRIC_RANGES[metric].min;
}

function parseDay(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const time = match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : NaN;
  if (Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== date) {
    throw new RangeError(`Anchor date must be a valid YYYY-MM-DD date, got "${date}"`);
  }
  return time;
}

function formatDay(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

function scopeKeyOf(scope: HistoryScope): string {
  return scope.kind === 'network' ? 'network' : `depot:${scope.depotId}`;
}

/** The weekly rhythm: weekend vs weekday direction is fixed per scope and metric. */
function weeklyOffsets(scopeKey: string, metric: MetricKey, span: number): readonly number[] {
  const rng = new SeededRandom(seedFor(scopeKey, 'weekly', `history:${metric}`));
  const weekendSign = rng.bool() ? 1 : -1;
  const amplitude = span * WEEKLY_SHARE;
  return Array.from({ length: 7 }, (_, dow) => {
    const base = WEEKEND_DAYS.has(dow) ? weekendSign * amplitude : 0;
    return base + rng.float(-0.25, 0.25) * amplitude;
  });
}

function shockOn(scopeKey: string, metric: MetricKey, date: string, span: number): number {
  const rng = new SeededRandom(seedFor(scopeKey, date, `history:${metric}:shock`));
  return rng.float(-1, 1) * span * SHOCK_SHARE;
}

/**
 * A daily series of `days` points (clamped to 7-180) ending on `anchor.date`
 * with exactly `anchor.value` (itself clamped to the metric's valid range).
 * With `anchor.ceiling`, no day exceeds it either and every point carries it.
 * Throws RangeError for a non-finite anchor value or ceiling, or an invalid
 * anchor date.
 */
export function modelSeries(
  metric: MetricKey,
  scope: HistoryScope,
  days: number,
  anchor: SeriesAnchor,
): SeriesPoint[] {
  if (!Number.isFinite(anchor.value)) {
    throw new RangeError(`Anchor value must be finite, got ${anchor.value}`);
  }
  const anchorTime = parseDay(anchor.date);
  const { min, decimals } = METRIC_RANGES[metric];
  const max = upperLimit(metric, anchor.ceiling);
  const count = clamp(Math.trunc(Number.isFinite(days) ? days : MIN_DAYS), MIN_DAYS, MAX_DAYS);
  const anchorValue = roundToDecimals(clamp(anchor.value, min, max), decimals);
  // Every day carries the unit's own limit, so a forecast of this series can clip to it.
  const limit = anchor.ceiling === undefined ? {} : { ceiling: max };

  const span = variationScale(metric, anchorValue);
  const scopeKey = scopeKeyOf(scope);
  const weekly = weeklyOffsets(scopeKey, metric, span);
  const weeklyAt = (time: number): number => weekly[new Date(time).getUTCDay()] as number;
  const anchorWeekly = weeklyAt(anchorTime);

  // Walk backwards: deviation is zero on the anchor day, then each earlier day
  // keeps part of the later day's deviation (pull back towards the anchor
  // level) plus its own date-seeded shock.
  const points: SeriesPoint[] = [{ date: anchor.date, value: anchorValue, ...limit }];
  let deviation = 0;
  for (let back = 1; back < count; back += 1) {
    const time = anchorTime - back * MS_PER_DAY;
    const date = formatDay(time);
    deviation = deviation * REVERSION + shockOn(scopeKey, metric, date, span);
    const raw = anchorValue + deviation + weeklyAt(time) - anchorWeekly;
    points.push({ date, value: roundToDecimals(clamp(raw, min, max), decimals), ...limit });
  }
  return points.reverse();
}
