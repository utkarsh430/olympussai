/**
 * Types for daily forecasts. A forecast is always reported with its band,
 * horizon, method and backtest error, so a page can state all four in words.
 */

export type ForecastMethod = 'seasonal_naive' | 'holt_winters';

export interface ForecastPoint {
  /** YYYY-MM-DD, consecutive days after the last history date. */
  readonly date: string;
  readonly value: number;
  readonly low: number;
  readonly high: number;
}

export interface Forecast {
  readonly method: ForecastMethod;
  readonly horizonDays: number;
  readonly points: readonly ForecastPoint[];
  /** Mean absolute one-step error of the chosen method, in the metric's own scale. */
  readonly backtestMae: number;
  /** How many one-step forecasts the backtest scored. */
  readonly backtestDays: number;
  readonly seasonalNaiveMae: number;
  /** Length of the contiguous run of days ending on the latest date. */
  readonly historyDays: number;
}

/** Input the forecast refuses, reported instead of thrown. */
export type InvalidInputReason =
  | 'invalid_date'
  | 'duplicate_date'
  | 'non_finite_value'
  | 'out_of_range'
  | 'invalid_horizon';

export type ForecastResult =
  | { readonly status: 'ok'; readonly forecast: Forecast }
  | {
      readonly status: 'insufficient_history';
      readonly historyDays: number;
      readonly required: number;
    }
  | { readonly status: 'invalid_input'; readonly reason: InvalidInputReason };
