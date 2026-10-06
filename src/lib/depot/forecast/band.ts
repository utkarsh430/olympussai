/**
 * The uncertainty band. Its half-width h days ahead is read from how wrong
 * the chosen method actually was h days ahead in the backtest (the quantile
 * of its absolute h-step errors), not from a distributional assumption or a
 * square-root rule, so an "80%" band covers about 80% of outcomes.
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

/**
 * Half-width from one horizon's absolute errors: their `q` quantile, or, when
 * that is zero but some error is not, the smallest non-zero error, so a
 * method that was ever wrong never draws a band of certainty.
 */
export function bandHalfWidth(absErrors: readonly number[], q: number): number {
  const quantile = nearestRankQuantile(absErrors, q);
  if (quantile > 0) return quantile;
  const nonZero = absErrors.filter((e) => e > 0);
  return nonZero.length === 0 ? 0 : Math.min(...nonZero);
}

function clip(value: number, range: ValidRange): number {
  return Math.min(range.max, Math.max(range.min, value));
}

/**
 * One forecast point. The value is clipped to the valid range first and the
 * band is built around the clipped value, then clipped itself, so a value at
 * the edge keeps its band on the inner side. Counts round all three to the
 * nearest bus; a non-zero band that rounding would close keeps one bus.
 */
export function bandPoint(
  date: string,
  rawValue: number,
  halfWidth: number,
  range: ValidRange,
  wholeNumbers: boolean,
): ForecastPoint {
  const value = clip(rawValue, range);
  const low = clip(value - halfWidth, range);
  const high = clip(value + halfWidth, range);
  if (!wholeNumbers) return { date, value, low, high };
  const whole = { date, value: Math.round(value), low: Math.round(low), high: Math.round(high) };
  if (halfWidth === 0 || whole.low < whole.high) return whole;
  // Rounding swallowed a band under half a bus: keep one bus on the inner side,
  // unless the range is a single value and there is no inner side to take.
  if (whole.value > range.min) return { ...whole, low: whole.value - 1 };
  if (whole.value < range.max) return { ...whole, high: whole.value + 1 };
  return whole;
}
