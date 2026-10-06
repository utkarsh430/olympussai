/**
 * Daily forecasts for one metric, with an honest band.
 *
 * Seasonal-naive is the baseline; Holt-Winters replaces it only when the
 * history is long enough to judge it and its backtest error clears the margin.
 * Pure: no clock, no randomness, and the input is never touched. The same
 * series (in any order) always gives the same forecast.
 */
import type { MetricKey, SeriesPoint } from '../sim/types';
import {
  BAND_QUANTILE,
  DEFAULT_HORIZON_DAYS,
  MAX_HORIZON_DAYS,
  MIN_HISTORY_DAYS,
  metricKindOf,
  validRangeOf,
} from './config';
import { bandHalfWidth, bandPoint, nearestRankQuantile } from './band';
import {
  backtestSeasonalNaive,
  bestHoltWinters,
  chooseMethod,
  type BacktestScore,
  type HoltWintersChoice,
} from './backtest';
import { fitHoltWinters, holtWintersForecast } from './holtWinters';
import { seasonalNaiveForecast } from './seasonalNaive';
import { addDays, prepareSeries } from './series';
import type { ForecastResult } from './types';

function validHorizon(horizonDays: number): boolean {
  return Number.isInteger(horizonDays) && horizonDays >= 1 && horizonDays <= MAX_HORIZON_DAYS;
}

interface MethodRun {
  readonly values: readonly number[];
  readonly score: BacktestScore;
}

/** The fitted Holt-Winters forecast, carrying the backtest score that chose it. */
function holtWintersRun(
  values: readonly number[],
  horizonDays: number,
  choice: HoltWintersChoice,
): MethodRun {
  const fit = fitHoltWinters(values, choice.params);
  if (fit === null) throw new RangeError('Holt-Winters was scored but cannot be fitted');
  return { values: holtWintersForecast(fit.state, horizonDays), score: choice.score };
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
  const naive = backtestSeasonalNaive(values);
  const holtWinters = bestHoltWinters(values);
  const { method, reason } = chooseMethod(naive.mae, holtWinters?.score.mae ?? null);
  const chosen: MethodRun =
    method === 'holt_winters' && holtWinters !== null
      ? holtWintersRun(values, horizonDays, holtWinters)
      : { values: seasonalNaiveForecast(values, horizonDays), score: naive };

  const quantile = nearestRankQuantile(chosen.score.residuals.map(Math.abs), BAND_QUANTILE);
  const wholeNumbers = metricKindOf(metric) === 'count';
  const points = chosen.values.map((value, i) =>
    bandPoint(addDays(last.date, i + 1), value, bandHalfWidth(quantile, i + 1), range, wholeNumbers),
  );

  return {
    status: 'ok',
    forecast: {
      method,
      reason,
      horizonDays,
      points,
      backtestMae: chosen.score.mae,
      backtestDays: naive.residuals.length,
      seasonalNaiveMae: naive.mae,
      holtWintersMae: holtWinters?.score.mae ?? null,
      historyDays: run.length,
    },
  };
}
