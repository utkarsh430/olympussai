/**
 * Daily forecasts for one metric, with an honest band.
 *
 * Pure: no clock, no randomness, and the input is never touched. The same
 * series (in any order) always gives the same forecast.
 */
import type { MetricKey, SeriesPoint } from '../sim/types';
import { BAND_QUANTILE, DEFAULT_HORIZON_DAYS, MAX_HORIZON_DAYS, MIN_HISTORY_DAYS } from './config';
import { metricKindOf, validRangeOf } from './config';
import { bandHalfWidth, bandPoint, nearestRankQuantile } from './band';
import { backtestSeasonalNaive } from './backtest';
import { seasonalNaiveForecast } from './seasonalNaive';
import { addDays, prepareSeries } from './series';
import type { ForecastResult } from './types';

function validHorizon(horizonDays: number): boolean {
  return Number.isInteger(horizonDays) && horizonDays >= 1 && horizonDays <= MAX_HORIZON_DAYS;
}

/**
 * Forecasts `horizonDays` days after the series' latest date. Refuses (with
 * a typed result, never a throw) bad input, and any run of contiguous days
 * shorter than `MIN_HISTORY_DAYS`.
 */
export function forecastSeries(
  series: readonly SeriesPoint[],
  metric: MetricKey,
  horizonDays: number = DEFAULT_HORIZON_DAYS,
): ForecastResult {
  if (!validHorizon(horizonDays)) return { status: 'invalid_input', reason: 'invalid_horizon' };
  const range = validRangeOf(metric);
  const prepared = prepareSeries(series, range);
  if (!prepared.ok) return { status: 'invalid_input', reason: prepared.reason };
  const { run } = prepared;
  const last = run.at(-1);
  if (last === undefined || run.length < MIN_HISTORY_DAYS) {
    return { status: 'insufficient_history', historyDays: run.length, required: MIN_HISTORY_DAYS };
  }

  const values = run.map((p) => p.value);
  const score = backtestSeasonalNaive(values);
  const forecast = seasonalNaiveForecast(values, horizonDays);
  const quantile = nearestRankQuantile(score.residuals.map(Math.abs), BAND_QUANTILE);
  const wholeNumbers = metricKindOf(metric) === 'count';
  const points = forecast.map((value, i) =>
    bandPoint(addDays(last.date, i + 1), value, bandHalfWidth(quantile, i + 1), range, wholeNumbers),
  );

  return {
    status: 'ok',
    forecast: {
      method: 'seasonal_naive',
      horizonDays,
      points,
      backtestMae: score.mae,
      backtestDays: score.residuals.length,
      seasonalNaiveMae: score.mae,
      historyDays: run.length,
    },
  };
}
