/**
 * Rolling-origin backtest. For each of the last days in the window, each
 * method forecasts that day from only the days before it, and is scored by
 * the mean absolute error of those one-step forecasts.
 */
import { BACKTEST_DAYS, SEASON_DAYS } from './config';
import { seasonalNaiveResiduals } from './seasonalNaive';

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
