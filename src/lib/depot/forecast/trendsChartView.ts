/**
 * What the two Trends pages print around the shared chart model (rulings S51 and the
 * round-2 decisions for these pages): the section label without a tag in its text, the
 * legend in four plain words, ONE text equivalent that says MODELLED once, the single
 * caption line under the chart, and the table rows with the values to sort by. The
 * shared chart model is read, never changed. Pure.
 */
import type { MetricUnit } from './api';
import { BAND_QUANTILE } from './config';
import {
  buildTrendChartModel,
  trendSummary,
  type LegendEntry,
  type TrendChartInput,
  type TrendChartModel,
} from './chartModel';
import { formatDate, formatValue } from './chartScale';
import type { TrendChange, TrendResult } from './trend';
import type { Forecast, TrendUnit } from './types';

const BAND_SHARE = Math.round(BAND_QUANTILE * 100);

/** The legend, in the order the page prints it: the live point last. */
export const TRENDS_LEGEND_LABEL: Readonly<Record<LegendEntry['key'], string>> = {
  history: 'History',
  forecast: 'Forecast',
  band: `${BAND_SHARE}% band`,
  live: 'Now (live)',
};

const UNIT_SHORT: Readonly<Record<TrendUnit, { one: string; many: string; decimals: number }>> = {
  percentage_points: { one: 'pp', many: 'pp', decimals: 1 },
  points: { one: 'point', many: 'points', decimals: 1 },
  buses: { one: 'bus', many: 'buses', decimals: 0 },
};

const WEEKS_AHEAD: Readonly<Record<number, string>> = {
  7: 'a week ahead',
  14: 'two weeks ahead',
  21: 'three weeks ahead',
  28: 'four weeks ahead',
};

function aheadWords(days: number): string {
  if (days === 1) return 'a day ahead';
  return WEEKS_AHEAD[days] ?? `${days} days ahead`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function trendPiece(change: TrendChange, span: string, unit: TrendUnit): string {
  if (change.direction === 'steady') return `steady over ${span}`;
  const { decimals, many } = UNIT_SHORT[unit];
  return `${change.direction} ${Math.abs(change.change).toFixed(decimals)} ${many} over ${span}`;
}

/** The table's Kind cell: plain words, never the tag word (R2-m16); the live point says so. */
export const TRENDS_KIND_WORDS: Readonly<Record<'history' | 'live' | 'forecast', string>> = {
  history: 'History',
  live: 'Now (live)',
  forecast: 'Forecast',
};

const METHOD_WORDS: Readonly<Record<Forecast['method'], string>> = {
  seasonal_naive: 'seasonal method',
  holt_winters: 'Holt-Winters method',
};

/**
 * The forecast's piece of the visible caption, led by its horizon and method so neither
 * lives only in the closed disclosure (R2-I5): "14-day forecast, seasonal method, within …".
 */
export function forecastPiece(forecast: Forecast): string {
  const lead = `${forecast.horizonDays}-day forecast, ${METHOD_WORDS[forecast.method]}`;
  return `${lead}, ${errorPiece(forecast).replace(/^forecast /, '')}`;
}

function errorPiece(forecast: Forecast): string {
  const { error } = forecast;
  const { decimals, one, many } = UNIT_SHORT[error.unit];
  const step = 10 ** -decimals;
  const scale = error.statedAsFraction ? 100 : 1;
  const show = (value: number): string => {
    const scaled = value * scale;
    const text = scaled < step / 2 ? `under ${step.toFixed(decimals)}` : scaled.toFixed(decimals);
    return `${text} ${Number(text) === 1 ? one : many}`;
  };
  const first = error.byDaysAhead[0];
  if (first === undefined) return 'forecast error not measured';
  const horizon = error.byDaysAhead.length;
  const last = error.byDaysAhead[horizon - 1] ?? first;
  const near = `${show(first)} ${aheadWords(1)}`;
  return horizon === 1
    ? `forecast within ${near}`
    : `forecast within ${near}, ${show(last)} ${aheadWords(horizon)}`;
}

/**
 * The one visible caption line: the four-week trend, the seven-day trend and the
 * forecast's error at one day and at the horizon, from the response. Null when there
 * is nothing to say (no trend and no forecast); a missing four-week trend says so.
 */
export function chartCaption(input: TrendChartInput): string | null {
  const trend: TrendResult = input.trend.result;
  const pieces: string[] = [];
  if (trend.status === 'ok') {
    const { fourWeeks, week, historyDays, unit } = trend.summary;
    pieces.push(
      fourWeeks === null
        ? `no trend over 4 weeks yet (${historyDays} of 29 days)`
        : trendPiece(fourWeeks, '4 weeks', unit),
    );
    pieces.push(trendPiece(week, '7 days', unit));
  }
  const forecast = input.forecast.result;
  if (forecast.status === 'ok') pieces.push(forecastPiece(forecast.forecast));
  return pieces.length === 0
    ? null
    : pieces.map((p, i) => (i === 0 ? capitalise(p) : p)).join(' · ');
}

export interface TrendsTableRow {
  readonly key: string;
  /** ISO date, to sort by. */
  readonly iso: string;
  readonly date: string;
  readonly value: string;
  readonly low: string;
  readonly high: string;
  readonly kind: string;
  readonly sortValue: number;
  readonly sortLow: number | null;
  readonly sortHigh: number | null;
}

export interface TrendsChartView {
  /** The shared model the plot draws; its own wording is not printed by these pages. */
  readonly model: TrendChartModel;
  readonly label: string;
  readonly legend: readonly LegendEntry[];
  readonly summary: string;
  readonly caption: string | null;
  readonly table: readonly TrendsTableRow[];
  /** True when a forecast is drawn: its band, its horizon and its error then stand with it. */
  readonly hasForecast: boolean;
  readonly horizonDays: number;
}

/**
 * The legend with the page's own labels, in the order of `labels`' keys; an entry the
 * model does not draw is left out.
 */
export function relabelLegend(
  legend: readonly LegendEntry[],
  labels: Readonly<Partial<Record<LegendEntry['key'], string>>>,
): readonly LegendEntry[] {
  const byKey = new Map(legend.map((entry) => [entry.key, entry] as const));
  return (Object.keys(labels) as LegendEntry['key'][]).flatMap((key) => {
    const entry = byKey.get(key);
    const label = labels[key];
    return entry === undefined || label === undefined ? [] : [{ ...entry, label }];
  });
}

/** The table view's rows, with the values to sort by and the Kind in plain words. */
export function trendsTableRows(
  model: TrendChartModel,
  unit: MetricUnit,
): readonly TrendsTableRow[] {
  return model.points.map((point, index): TrendsTableRow => {
    const row = model.table[index];
    return {
      key: point.date,
      iso: point.date,
      date: row?.date ?? formatDate(point.date, true),
      value: row?.value ?? formatValue(point.value, unit),
      low: row?.low ?? '',
      high: row?.high ?? '',
      kind: TRENDS_KIND_WORDS[point.kind],
      sortValue: point.value,
      sortLow: point.low,
      sortHigh: point.high,
    };
  });
}

export function buildTrendsChartView(input: TrendChartInput): TrendsChartView {
  const model = buildTrendChartModel(input);
  const hasForecast = model.points.some((p) => p.kind === 'forecast');
  return {
    model,
    label: `${input.metric.label}: trend and forecast`,
    legend: relabelLegend(model.legend, TRENDS_LEGEND_LABEL),
    // Built once with MODELLED in its one place, never repaired from the shared string.
    summary: trendSummary(input, model.points, 'once'),
    caption: chartCaption(input),
    table: trendsTableRows(model, input.metric.unit),
    hasForecast,
    horizonDays: input.horizonDays,
  };
}
