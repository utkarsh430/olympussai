/**
 * The words every page prints about a trend or forecast, built once here so a
 * page cannot drift into its own phrasing. Rates are stored as fractions; any
 * sentence states them in percentage points.
 */
import type { MetricKey } from '../sim/types';
import type {
  ForecastMetricInfo,
  ForecastSentences,
  MetricUnit,
} from './api';
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
import type { Forecast, ForecastResult } from './types';

export const METRIC_LABEL: Readonly<Record<MetricKey, string>> = {
  onRoadShare: 'On-road share',
  offRoadRate: 'Off-road rate',
  darkRate: 'Dark rate',
  index: 'Efficiency index',
  available: 'Buses available',
};

/** Mirrors `holtWintersOffered`: two full seasons before the backtest window. */
export const WEEKLY_SMOOTHING_MIN_DAYS = BACKTEST_DAYS + 2 * SEASON_DAYS;

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

const ERROR_FORMAT: Readonly<Record<MetricKind, ErrorFormat>> = {
  rate: { scale: 100, decimals: 1, one: 'percentage points', many: 'percentage points' },
  index: { scale: 1, decimals: 1, one: 'points', many: 'points' },
  count: { scale: 1, decimals: 0, one: 'bus', many: 'buses' },
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

/** "Typical error about 1.2 percentage points over the last four weeks." */
export function errorSentence(metric: MetricKey, mae: number, backtestDays: number): string {
  const span = spanWords(backtestDays);
  if (mae === 0) return `No error over ${span}.`;
  const format = ERROR_FORMAT[metricKindOf(metric)];
  const step = 10 ** -format.decimals;
  const scaled = mae * format.scale;
  if (scaled < step / 2) {
    return `Typical error under ${step.toFixed(format.decimals)} ${format.one} over ${span}.`;
  }
  const shown = scaled.toFixed(format.decimals);
  const unit = Number(shown) === 1 ? format.one : format.many;
  return `Typical error about ${shown} ${unit} over ${span}.`;
}

const REPEAT_WEEK = 'Forecast repeats the same weekday from the week before.';

export function methodSentence(forecast: Forecast): string {
  const span = spanWords(forecast.backtestDays);
  switch (forecast.reason) {
    case 'short_history':
      return (
        `${REPEAT_WEEK} Weekly smoothing needs ${WEEKLY_SMOOTHING_MIN_DAYS} days of history ` +
        `and this series has ${forecast.historyDays}.`
      );
    case 'within_margin':
      return `${REPEAT_WEEK} Weekly smoothing was not clearly more accurate over ${span}.`;
    case 'holt_winters_better':
      return (
        'Forecast by weekly smoothing (Holt-Winters), which was more accurate than repeating ' +
        `the week before over ${span}.`
      );
  }
}

export function horizonSentence(horizonDays: number): string {
  const share = Math.round(BAND_QUANTILE * 100);
  return (
    `Forecast for the next ${horizonDays} days. The band is where ${share}% of past ` +
    'one-day errors fell, widened for each further day ahead.'
  );
}

export function unavailableSentence(result: ForecastResult): string | null {
  if (result.status === 'ok') return null;
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
    error: forecast && errorSentence(metric, forecast.error.overHorizon, forecast.backtestDays),
    horizon: forecast && horizonSentence(horizonDays),
    unavailable: unavailableSentence(result),
  };
}
