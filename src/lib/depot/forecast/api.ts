/**
 * Payload of GET /api/upsrtc/depot/forecast: one metric's modelled history
 * ending on today's live value, its trend summary and its forecast, with every
 * sentence a page prints about them already written. Pages render these
 * strings; they never compose their own wording about a forecast.
 */
import type { DepotFeedEnvelope } from '../api';
import type { HistoryScope, MetricKey, SeriesAnchor, SeriesPoint } from '../sim/types';
import type { MetricKind } from './config';
import type { TrendDirection, TrendResult, TrendUnit } from './trend';

export const DEPOT_TRENDS_ENDPOINT = '/api/upsrtc/depot/trends';

/** One row's trend in brief: what a sparkline cell prints beside its line. */
export interface TrendBrief {
  /** The headline direction: the four-week one when there is one, else the week's. */
  readonly direction: TrendDirection;
  /** Change over 7 days, in the metric's trend unit, rounded as printed. */
  readonly week: number;
  /** Change over 28 days; null when the history is shorter than 29 days. */
  readonly fourWeeks: number | null;
  /** "MODELLED trend: up 2.1 percentage points over 4 weeks". */
  readonly sentence: string;
}

/** The network or one unit: a compact MODELLED series for a sparkline and its trend. */
export interface TrendRow {
  /** 'network', or the depot id. */
  readonly id: string;
  readonly name: string;
  /** Date of the last value, which is the live value; empty when there is no value. */
  readonly endDate: string;
  /** Oldest first, one per day, ending on the live value. Empty when there is no value. */
  readonly values: readonly number[];
  /** Null when there is no value or too little history for a trend. */
  readonly trend: TrendBrief | null;
}

/** Payload of GET /api/upsrtc/depot/trends: every sparkline of one metric, no forecast. */
export interface DepotTrendsResponse extends DepotFeedEnvelope {
  readonly provenance: 'modelled';
  readonly metric: ForecastMetricInfo;
  readonly trendUnit: TrendUnit;
  /** Days in each `values`. */
  readonly days: number;
  readonly network: TrendRow;
  readonly units: readonly TrendRow[];
}
import type { ForecastResult } from './types';

export const DEPOT_FORECAST_ENDPOINT = '/api/upsrtc/depot/forecast';

/** A rate travels as a 0-1 fraction; pages show it as a percentage. */
export type MetricUnit = 'fraction' | 'points' | 'buses';

export interface MetricValueRange {
  readonly min: number;
  /** Null when there is no upper bound (JSON cannot carry Infinity). */
  readonly max: number | null;
}

export interface ForecastMetricInfo {
  readonly key: MetricKey;
  /** Sentence-case name, e.g. "On-road share". */
  readonly label: string;
  readonly kind: MetricKind;
  readonly unit: MetricUnit;
  /** The unit in words, e.g. "share of the fleet, 0 to 1". */
  readonly unitLabel: string;
  readonly range: MetricValueRange;
  readonly higherIsBetter: boolean;
}

/** Every line a page prints about this trend and forecast. Null where it does not apply. */
export interface ForecastSentences {
  /** Chart title; always carries MODELLED. */
  readonly title: string;
  /** "MODELLED trend: up 2.1 percentage points over 4 weeks". */
  readonly trend: string | null;
  /** The method in plain words, and why it was chosen. */
  readonly method: string | null;
  /** The backtest error in the metric's display unit. */
  readonly error: string | null;
  /** The horizon and what the band means. */
  readonly horizon: string | null;
  /** Why no forecast is shown; null when there is one. */
  readonly unavailable: string | null;
}

export interface ModelledSection<T> {
  readonly provenance: 'modelled';
  readonly result: T;
}

export interface ForecastSections {
  readonly trend: ModelledSection<TrendResult>;
  readonly forecast: ModelledSection<ForecastResult>;
  readonly sentences: ForecastSentences;
}

export interface DepotForecastResponse extends DepotFeedEnvelope, ForecastSections {
  readonly metric: ForecastMetricInfo;
  readonly scope: HistoryScope;
  readonly horizonDays: number;
  readonly history: {
    readonly provenance: 'modelled';
    /** The series the trend and forecast were computed from; its last point is the live value. */
    readonly series: readonly SeriesPoint[];
    readonly anchor: SeriesAnchor;
  };
}
