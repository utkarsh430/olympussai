/**
 * Types for daily forecasts. A forecast is always reported with its band,
 * horizon, method and backtest error, so a page can state all four in words.
 */

/** The unit a change or error is stated in. */
export type TrendUnit = 'percentage_points' | 'points' | 'buses';

/**
 * How wrong the chosen method was in the rolling-origin backtest, by days
 * ahead. The numbers are in the metric's stored scale: for a rate that is a
 * fraction of 1 (`statedAsFraction`), so 0.012 is 1.2 percentage points.
 */
export interface ForecastError {
  /** Mean of `byDaysAhead`: the typical error over the horizon that is drawn. */
  readonly overHorizon: number;
  /** Index h-1: mean absolute error of the h-days-ahead forecasts. */
  readonly byDaysAhead: readonly number[];
  /** The unit a page states it in. */
  readonly unit: TrendUnit;
  /** True for rates: multiply by 100 to read it in `unit` (percentage points). */
  readonly statedAsFraction: boolean;
}

export type ForecastMethod = 'seasonal_naive' | 'holt_winters';

/**
 * Why the method was chosen, as a code a page can turn into a sentence:
 * - `short_history`: fewer than two full weeks before the earliest scored forecast, so
 *   Holt-Winters was not offered and the seasonal-naive baseline was used.
 * - `within_margin`: Holt-Winters did not beat the baseline by more than the
 *   margin, so the simpler method was kept.
 * - `holt_winters_better`: Holt-Winters beat the baseline by more than the margin.
 */
export type MethodReason = 'short_history' | 'within_margin' | 'holt_winters_better';

export interface ForecastPoint {
  /** YYYY-MM-DD, consecutive days after the last history date. */
  readonly date: string;
  readonly value: number;
  readonly low: number;
  readonly high: number;
}

export interface Forecast {
  readonly method: ForecastMethod;
  readonly reason: MethodReason;
  readonly horizonDays: number;
  readonly points: readonly ForecastPoint[];
  /** The chosen method's backtest error over the horizon, by days ahead. */
  readonly error: ForecastError;
  /** How many days (the last four weeks, or fewer) the backtest forecast. */
  readonly backtestDays: number;
  /** Seasonal-naive's error over the horizon, in the same scale as `error`. */
  readonly seasonalNaiveError: number;
  /** Holt-Winters' error over the horizon; null when not offered (`short_history`). */
  readonly holtWintersError: number | null;
  /** Length of the contiguous run of days ending on the latest date. */
  readonly historyDays: number;
}

/** A daily series refused as a whole, reported instead of thrown. */
export type SeriesInputReason =
  | 'invalid_date'
  | 'duplicate_date'
  | 'non_finite_value'
  | 'out_of_range'
  | 'non_integer_count';

/**
 * Why a run is too short. `gap`: earlier days exist but a missing day ends
 * the run, and `missingDate` is that day (the latest one missing). `short_record`:
 * the series simply does not reach back far enough; `missingDate` is null.
 */
export interface InsufficientHistory {
  readonly status: 'insufficient_history';
  readonly historyDays: number;
  readonly required: number;
  readonly cause: 'gap' | 'short_record';
  readonly missingDate: string | null;
}

/** Input the forecast refuses, reported instead of thrown. */
export type InvalidInputReason = SeriesInputReason | 'invalid_horizon';

export type ForecastResult =
  | { readonly status: 'ok'; readonly forecast: Forecast }
  | InsufficientHistory
  | { readonly status: 'invalid_input'; readonly reason: InvalidInputReason };
