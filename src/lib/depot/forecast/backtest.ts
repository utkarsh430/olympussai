/**
 * Rolling-origin backtest over the horizon that is drawn. Every day in the
 * window (the last four weeks) is forecast 1, 2, ... H days ahead, each time
 * from only the days before that forecast's origin, so a method is judged on
 * exactly the kind of forecast the page shows. The error h days ahead is the
 * mean absolute error of those h-step forecasts; the method's score is the
 * mean of those errors over h = 1..H.
 */
import {
  ALPHA_GRID,
  BACKTEST_DAYS,
  BETA_GRID,
  GAMMA_GRID,
  METHOD_MARGIN,
  MIN_BAND_SAMPLES,
  SEASON_DAYS,
} from './config';
import { fitHoltWinters, type HoltWintersParams } from './holtWinters';
import { pooledErrors } from './pool';
import { seasonalNaiveForecast } from './seasonalNaive';
import type { ForecastMethod, MethodReason } from './types';

export interface HorizonScore {
  /** Index h-1: the absolute h-step errors pooled per `pooledErrors`, oldest target first. */
  readonly errorsByDay: readonly (readonly number[])[];
  /** Index h-1: the mean of `errorsByDay[h-1]`. */
  readonly maeByDay: readonly number[];
  /** The mean of `maeByDay`: the error over the drawn horizon. Zero for a perfect fit. */
  readonly mae: number;
}

/**
 * Days scored as targets: the last four weeks, shortened when the history
 * leaves less than that after the first season.
 */
export function backtestWindow(historyDays: number): number {
  return Math.max(0, Math.min(BACKTEST_DAYS, historyDays - SEASON_DAYS));
}

/**
 * Holt-Winters initialises from two full seasons, so it is offered only when
 * every forecast the backtest scores (the earliest starts H - 1 days before
 * the window) has two full seasons before its origin.
 */
export function holtWintersOffered(historyDays: number, horizon: number): boolean {
  return historyDays - BACKTEST_DAYS - (horizon - 1) >= 2 * SEASON_DAYS;
}

/** The earliest origin any scored forecast may start from. */
function firstOrigin(historyDays: number, horizon: number): number {
  return holtWintersOffered(historyDays, horizon) ? 2 * SEASON_DAYS : SEASON_DAYS;
}

/**
 * Raw absolute errors per days ahead. `pathFrom(o)` is the forecast from
 * origin o (using days before o only) of days o, o+1, ...
 */
function errorsByHorizon(
  values: readonly number[],
  horizon: number,
  pathFrom: (origin: number) => readonly number[],
): number[][] {
  const n = values.length;
  const first = n - backtestWindow(n);
  const minOrigin = firstOrigin(n, horizon);
  return Array.from({ length: horizon }, (_, i) => {
    const errors: number[] = [];
    for (let t = first; t < n; t += 1) {
      const origin = t - i;
      if (origin >= minOrigin) {
        errors.push(Math.abs((values[t] as number) - (pathFrom(origin)[i] as number)));
      }
    }
    return errors;
  });
}

export function scoreErrors(raw: readonly (readonly number[])[]): HorizonScore {
  const errorsByDay = pooledErrors(raw, MIN_BAND_SAMPLES);
  const maeByDay = errorsByDay.map((e) =>
    e.length === 0 ? 0 : e.reduce((s, v) => s + v, 0) / e.length,
  );
  const mae = maeByDay.length === 0 ? 0 : maeByDay.reduce((s, v) => s + v, 0) / maeByDay.length;
  return { errorsByDay, maeByDay, mae };
}

export function backtestSeasonalNaive(values: readonly number[], horizon: number): HorizonScore {
  const paths = new Map<number, number[]>();
  const pathFrom = (origin: number): number[] => {
    const path = paths.get(origin) ?? seasonalNaiveForecast(values.slice(0, origin), horizon);
    paths.set(origin, path);
    return path;
  };
  return scoreErrors(errorsByHorizon(values, horizon, pathFrom));
}

/** Null when Holt-Winters is not offered for this history and horizon. */
export function backtestHoltWinters(
  values: readonly number[],
  params: HoltWintersParams,
  horizon: number,
): HorizonScore | null {
  if (!holtWintersOffered(values.length, horizon)) return null;
  const from = 2 * SEASON_DAYS;
  const fit = fitHoltWinters(values, params, SEASON_DAYS, { from, horizon });
  if (fit === null) return null;
  const pathFrom = (origin: number): readonly number[] => fit.paths[origin - from] as number[];
  return scoreErrors(errorsByHorizon(values, horizon, pathFrom));
}

export interface HoltWintersChoice {
  readonly params: HoltWintersParams;
  readonly score: HorizonScore;
}

/**
 * The grid point with the lowest error over the horizon. The grid is walked
 * alpha, then beta, then gamma, each ascending, and only a strictly lower
 * error replaces the best, so ties keep the smallest parameters in that order.
 */
export function bestHoltWinters(
  values: readonly number[],
  horizon: number,
): HoltWintersChoice | null {
  let best: HoltWintersChoice | null = null;
  for (const alpha of ALPHA_GRID) {
    for (const beta of BETA_GRID) {
      for (const gamma of GAMMA_GRID) {
        const params = { alpha, beta, gamma };
        const score = backtestHoltWinters(values, params, horizon);
        if (score !== null && (best === null || score.mae < best.score.mae))
          best = { params, score };
      }
    }
  }
  return best;
}

export interface MethodChoice {
  readonly method: ForecastMethod;
  readonly reason: MethodReason;
}

/**
 * Holt-Winters only when its error is lower than the baseline's by more than
 * the margin. Ties and near-ties go to the simpler seasonal-naive, so a
 * method that wins by noise alone never displaces it.
 */
export function chooseMethod(
  seasonalNaiveMae: number,
  holtWintersMae: number | null,
): MethodChoice {
  if (holtWintersMae === null) return { method: 'seasonal_naive', reason: 'short_history' };
  if (holtWintersMae < seasonalNaiveMae * (1 - METHOD_MARGIN)) {
    return { method: 'holt_winters', reason: 'holt_winters_better' };
  }
  return { method: 'seasonal_naive', reason: 'within_margin' };
}
