/**
 * Daily forecasts for one metric, with an honest band.
 *
 * Seasonal-naive is the baseline; Holt-Winters replaces it only when the
 * history is long enough to judge it and its error over the drawn horizon
 * clears the margin. The band h days ahead is the 80th percentile of the
 * chosen method's h-step backtest errors. Pure: no clock, no randomness, and
 * the input is never touched. The same series (in any order) always gives
 * the same forecast.
 */
import type { MetricKey, SeriesPoint } from '../sim/types';
import {
  BAND_QUANTILE,
  DEFAULT_HORIZON_DAYS,
  MAX_HORIZON_DAYS,
  MIN_HISTORY_DAYS,
  metricKindOf,
  seriesRulesOf,
  UNIT_OF_KIND,
  validRangeOf,
} from './config';
import { bandHalfWidth, bandPoint } from './band';
import {
  backtestSeasonalNaive,
  backtestWindow,
  bestHoltWinters,
  chooseMethod,
  type HorizonScore,
  type HoltWintersChoice,
} from './backtest';
import { fitHoltWinters, holtWintersForecast } from './holtWinters';
import { seasonalNaiveForecast } from './seasonalNaive';
import { addDays, insufficientHistory, prepareSeries } from './series';
import type { ForecastError, ForecastResult } from './types';

function validHorizon(horizonDays: number): boolean {
  return Number.isInteger(horizonDays) && horizonDays >= 1 && horizonDays <= MAX_HORIZON_DAYS;
}

interface MethodRun {
  readonly values: readonly number[];
  readonly score: HorizonScore;
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

function errorOf(metric: MetricKey, score: HorizonScore): ForecastError {
  const kind = metricKindOf(metric);
  return {
    overHorizon: score.mae,
    byDaysAhead: score.maeByDay,
    unit: UNIT_OF_KIND[kind],
    statedAsFraction: kind === 'rate',
  };
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
  const prepared = prepareSeries(series, seriesRulesOf(metric));
  if (!prepared.ok) return { status: 'invalid_input', reason: prepared.reason };
  const { run } = prepared;
  const last = run.at(-1);
  if (last === undefined || run.length < MIN_HISTORY_DAYS) {
    return insufficientHistory(prepared, MIN_HISTORY_DAYS);
  }

  const values = run.map((p) => p.value);
  const naive = backtestSeasonalNaive(values, horizonDays);
  const holtWinters = bestHoltWinters(values, horizonDays);
  const { method, reason } = chooseMethod(naive.mae, holtWinters?.score.mae ?? null);
  const chosen: MethodRun =
    method === 'holt_winters' && holtWinters !== null
      ? holtWintersRun(values, horizonDays, holtWinters)
      : { values: seasonalNaiveForecast(values, horizonDays), score: naive };

  const range = validRangeOf(metric);
  const wholeNumbers = metricKindOf(metric) === 'count';
  const points = chosen.values.map((value, i) => {
    const half = bandHalfWidth(chosen.score.errorsByDay[i] as readonly number[], BAND_QUANTILE);
    return bandPoint(addDays(last.date, i + 1), value, half, range, wholeNumbers);
  });

  return {
    status: 'ok',
    forecast: {
      method,
      reason,
      horizonDays,
      points,
      error: errorOf(metric, chosen.score),
      backtestDays: backtestWindow(values.length),
      seasonalNaiveError: naive.mae,
      holtWintersError: holtWinters?.score.mae ?? null,
      historyDays: run.length,
    },
  };
}
