/**
 * Types for daily forecasts. A forecast is always reported with its band,
 * horizon, method and backtest error, so a page can state all four in words.
 */

export type ForecastMethod = 'seasonal_naive' | 'holt_winters';

/**
 * Why the method was chosen, as a code a page can turn into a sentence:
 * - `short_history`: fewer than two full weeks before the backtest window, so
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
  /** Mean absolute one-step error of the chosen method, in the metric's own scale. */
  readonly backtestMae: number;
  /** How many one-step forecasts the backtest scored. */
  readonly backtestDays: number;
  readonly seasonalNaiveMae: number;
  /** Null when Holt-Winters was not offered (`short_history`). */
  readonly holtWintersMae: number | null;
  /** Length of the contiguous run of days ending on the latest date. */
  readonly historyDays: number;
}

/** A daily series refused as a whole, reported instead of thrown. */
export type SeriesInputReason = 'invalid_date' | 'duplicate_date' | 'non_finite_value' | 'out_of_range';

/** Input the forecast refuses, reported instead of thrown. */
export type InvalidInputReason = SeriesInputReason | 'invalid_horizon';

export type ForecastResult =
  | { readonly status: 'ok'; readonly forecast: Forecast }
  | {
      readonly status: 'insufficient_history';
      readonly historyDays: number;
      readonly required: number;
    }
  | { readonly status: 'invalid_input'; readonly reason: InvalidInputReason };
