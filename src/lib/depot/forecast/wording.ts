/**
 * The words every page prints about a trend or forecast, built once here so a
 * page cannot drift into its own phrasing. Rates are stored as fractions; any
 * sentence states them in percentage points.
 */
import type { MetricKey } from '../sim/types';
import type { ForecastMetricInfo, ForecastSentences, MetricUnit } from './api';
import {
  BACKTEST_DAYS,
  BAND_QUANTILE,
  higherIsBetter,
  metricKindOf,
  SEASON_DAYS,
  validRangeOf,
  type MetricKind,
} from './config';
import type { TrendResult } from './trend';
import { formatDate } from './chartScale';
import type { Forecast, ForecastError, ForecastResult, TrendUnit } from './types';

export const METRIC_LABEL: Readonly<Record<MetricKey, string>> = {
  onRoadShare: 'On-road share',
  offRoadRate: 'Off-road rate',
  darkRate: 'Dark rate',
  index: 'Efficiency index',
  available: 'Buses available',
};

/** Mirrors `holtWintersOffered`: two full seasons before the earliest scored forecast. */
export function weeklySmoothingMinDays(horizonDays: number): number {
  return BACKTEST_DAYS + (horizonDays - 1) + 2 * SEASON_DAYS;
}

const UNIT: Readonly<Record<MetricKind, { readonly unit: MetricUnit; readonly label: string }>> = {
  rate: { unit: 'fraction', label: 'share of the fleet, 0 to 1' },
  index: { unit: 'points', label: 'points, 0 to 100' },
  count: { unit: 'buses', label: 'buses' },
};

interface ErrorFormat {
  readonly scale: number;
  readonly decimals: number;
  readonly one: string;
  readonly many: string;
}

const ERROR_FORMAT: Readonly<Record<TrendUnit, ErrorFormat>> = {
  percentage_points: { scale: 1, decimals: 1, one: 'percentage points', many: 'percentage points' },
  points: { scale: 1, decimals: 1, one: 'points', many: 'points' },
  buses: { scale: 1, decimals: 0, one: 'bus', many: 'buses' },
};

export function metricInfo(metric: MetricKey): ForecastMetricInfo {
  const kind = metricKindOf(metric);
  const { min, max } = validRangeOf(metric);
  return {
    key: metric,
    label: METRIC_LABEL[metric],
    kind,
    unit: UNIT[kind].unit,
    unitLabel: UNIT[kind].label,
    range: { min, max: Number.isFinite(max) ? max : null },
    higherIsBetter: higherIsBetter(metric),
  };
}

function spanWords(days: number): string {
  return days === BACKTEST_DAYS ? 'the last four weeks' : `the last ${days} days`;
}

/** One error in its unit: "1.2 percentage points", "1 bus", "under 0.1 points". */
function amount(value: number, error: ForecastError, withUnit: boolean): string {
  const format = ERROR_FORMAT[error.unit];
  const scaled = value * (error.statedAsFraction ? 100 : 1) * format.scale;
  const step = 10 ** -format.decimals;
  const shown =
    scaled < step / 2 ? `under ${step.toFixed(format.decimals)}` : scaled.toFixed(format.decimals);
  if (!withUnit) return shown;
  return `${shown} ${Number(shown) === 1 ? format.one : format.many}`;
}

const WEEKS_WORDS: Readonly<Record<number, string>> = {
  7: 'a week',
  14: 'two weeks',
  21: 'three weeks',
  28: 'four weeks',
};

function daysAhead(days: number): string {
  if (days === 1) return 'a day ahead';
  return `${WEEKS_WORDS[days] ?? `${days} days`} ahead`;
}

/**
 * "MODELLED: typically within 1.2 percentage points a day ahead and 2.9 two
 * weeks ahead, judged on the last four weeks." The second figure drops its
 * unit when it reads the same as the first's.
 */
export function errorSentence(error: ForecastError, backtestDays: number): string {
  const span = spanWords(backtestDays);
  if (error.overHorizon === 0) return `MODELLED: no error in the backtest over ${span}.`;
  const first = error.byDaysAhead[0] ?? 0;
  const horizon = error.byDaysAhead.length;
  const near = `${amount(first, error, true)} ${daysAhead(1)}`;
  if (horizon === 1) return `MODELLED: typically within ${near}, judged on ${span}.`;
  const last = error.byDaysAhead[horizon - 1] ?? 0;
  const firstUnit = amount(first, error, true).slice(amount(first, error, false).length);
  const lastUnit = amount(last, error, true).slice(amount(last, error, false).length);
  const lastShown = amount(last, error, firstUnit !== lastUnit || !WEEKS_WORDS[horizon]);
  return `MODELLED: typically within ${near} and ${lastShown} ${daysAhead(horizon)}, judged on ${span}.`;
}

const REPEAT_WEEK = 'Forecast repeats the same weekday from the week before.';

export function methodSentence(forecast: Forecast): string {
  const span = spanWords(forecast.backtestDays);
  switch (forecast.reason) {
    case 'short_history':
      return (
        `${REPEAT_WEEK} Weekly smoothing needs ${weeklySmoothingMinDays(forecast.horizonDays)} ` +
        `days of history for a ${forecast.horizonDays}-day forecast and this series has ` +
        `${forecast.historyDays}.`
      );
    case 'within_margin':
      return `${REPEAT_WEEK} Weekly smoothing was not clearly more accurate over ${span}.`;
    case 'holt_winters_better':
      return (
        'Forecast by weekly smoothing (Holt-Winters), which was more accurate than repeating ' +
        `the week before across the ${forecast.horizonDays} days ahead, judged on ${span}.`
      );
  }
}

export function horizonSentence(horizonDays: number): string {
  const share = Math.round(BAND_QUANTILE * 100);
  return (
    `Forecast for the next ${horizonDays} days. For each day ahead, the band is where ` +
    `${share}% of past forecasts that many days ahead fell.`
  );
}

export function unavailableSentence(result: ForecastResult): string | null {
  if (result.status === 'ok') return null;
  if (result.status === 'insufficient_history' && result.missingDate !== null) {
    return (
      `No forecast: the history is missing ${formatDate(result.missingDate, true)}, so only the ` +
      `${result.historyDays} days since count, and a forecast needs ${result.required}.`
    );
  }
  if (result.status === 'insufficient_history') {
    return (
      `No forecast: it needs at least ${result.required} days of history and this series ` +
      `has ${result.historyDays}.`
    );
  }
  return 'No forecast: the history for this measure could not be read.';
}

export function trendSentence(result: TrendResult): string | null {
  return result.status === 'ok' ? `MODELLED trend: ${result.summary.sentence}` : null;
}

export function forecastSentences(
  metric: MetricKey,
  trend: TrendResult,
  result: ForecastResult,
  horizonDays: number,
): ForecastSentences {
  const forecast = result.status === 'ok' ? result.forecast : null;
  return {
    title: `${METRIC_LABEL[metric]}: trend and forecast, MODELLED`,
    trend: trendSentence(trend),
    method: forecast && methodSentence(forecast),
    error: forecast && errorSentence(forecast.error, forecast.backtestDays),
    horizon: forecast && horizonSentence(horizonDays),
    unavailable: unavailableSentence(result),
  };
}
