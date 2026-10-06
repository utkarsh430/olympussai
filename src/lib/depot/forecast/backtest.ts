/**
 * Rolling-origin backtest. For each of the last days in the window, each
 * method forecasts that day from only the days before it, and is scored by
 * the mean absolute error of those one-step forecasts.
 */
import {
  ALPHA_GRID,
  BACKTEST_DAYS,
  BETA_GRID,
  GAMMA_GRID,
  METHOD_MARGIN,
  SEASON_DAYS,
} from './config';
import { fitHoltWinters, type HoltWintersParams } from './holtWinters';
import { seasonalNaiveResiduals } from './seasonalNaive';
import type { ForecastMethod, MethodReason } from './types';

export interface BacktestScore {
  /** Mean absolute one-step error; zero for a perfect fit. */
  readonly mae: number;
  /** Signed residuals, actual minus forecast, oldest first. */
  readonly residuals: readonly number[];
}

/**
 * Days the backtest scores: the last four weeks, shortened when the history
 * leaves less than that after the first season (seasonal-naive needs one
 * season before its first forecast).
 */
export function backtestWindow(historyDays: number): number {
  return Math.max(0, Math.min(BACKTEST_DAYS, historyDays - SEASON_DAYS));
}

export function scoreResiduals(residuals: readonly number[]): BacktestScore {
  const total = residuals.reduce((sum, r) => sum + Math.abs(r), 0);
  return { mae: residuals.length === 0 ? 0 : total / residuals.length, residuals };
}

export function backtestSeasonalNaive(values: readonly number[]): BacktestScore {
  return scoreResiduals(seasonalNaiveResiduals(values, backtestWindow(values.length)));
}

/**
 * Holt-Winters needs two full seasons to initialise before the first day it
 * is scored on; with less, the comparison would not be fair and it is not offered.
 */
export function holtWintersOffered(historyDays: number): boolean {
  return historyDays - BACKTEST_DAYS >= 2 * SEASON_DAYS;
}

/** Null when Holt-Winters is not offered for a series this long. */
export function backtestHoltWinters(
  values: readonly number[],
  params: HoltWintersParams,
): BacktestScore | null {
  if (!holtWintersOffered(values.length)) return null;
  const fit = fitHoltWinters(values, params);
  if (fit === null) return null;
  const first = values.length - backtestWindow(values.length);
  return scoreResiduals(values.slice(first).map((v, i) => v - (fit.oneStep[first + i] as number)));
}

export interface HoltWintersChoice {
  readonly params: HoltWintersParams;
  readonly score: BacktestScore;
}

/**
 * The grid point with the lowest backtest error. The grid is walked alpha,
 * then beta, then gamma, each ascending, and only a strictly lower error
 * replaces the best, so ties keep the smallest parameters in that order.
 */
export function bestHoltWinters(values: readonly number[]): HoltWintersChoice | null {
  let best: HoltWintersChoice | null = null;
  for (const alpha of ALPHA_GRID) {
    for (const beta of BETA_GRID) {
      for (const gamma of GAMMA_GRID) {
        const params = { alpha, beta, gamma };
        const score = backtestHoltWinters(values, params);
        if (score !== null && (best === null || score.mae < best.score.mae)) best = { params, score };
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
export function chooseMethod(seasonalNaiveMae: number, holtWintersMae: number | null): MethodChoice {
  if (holtWintersMae === null) return { method: 'seasonal_naive', reason: 'short_history' };
  if (holtWintersMae < seasonalNaiveMae * (1 - METHOD_MARGIN)) {
    return { method: 'holt_winters', reason: 'holt_winters_better' };
  }
  return { method: 'seasonal_naive', reason: 'within_margin' };
}
