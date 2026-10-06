/**
 * The uncertainty band. Its width is read from how wrong the chosen method
 * actually was in the backtest, not from a distributional assumption, and it
 * grows with the square root of the days ahead, as errors that accumulate
 * day by day do.
 */
import type { ValidRange } from './config';
import type { ForecastPoint } from './types';

/**
 * Nearest-rank quantile: the smallest value with at least `q` of the sample at
 * or below it. Zero for an empty sample, so a band can never become NaN.
 */
export function nearestRankQuantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(q * sorted.length)));
  return sorted[rank - 1] as number;
}

/** Half-width of the band `daysAhead` days out, from the one-day residual quantile. */
export function bandHalfWidth(residualQuantile: number, daysAhead: number): number {
  return residualQuantile * Math.sqrt(daysAhead);
}

function clip(value: number, range: ValidRange): number {
  return Math.min(range.max, Math.max(range.min, value));
}

/**
 * One forecast point: the band around `value`, then the value and both edges
 * clipped to the valid range, then whole numbers for counts. Rounding after
 * clipping keeps low <= value <= high, since rounding never reorders.
 */
export function bandPoint(
  date: string,
  value: number,
  halfWidth: number,
  range: ValidRange,
  wholeNumbers: boolean,
): ForecastPoint {
  const finish = (v: number): number => (wholeNumbers ? Math.round(clip(v, range)) : clip(v, range));
  return {
    date,
    value: finish(value),
    low: finish(value - halfWidth),
    high: finish(value + halfWidth),
  };
}
