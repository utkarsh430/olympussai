/**
 * Payload of GET /api/upsrtc/depot/forecast: one metric's modelled history
 * ending on today's live value, its trend summary and its forecast, with every
 * sentence a page prints about them already written. Pages render these
 * strings; they never compose their own wording about a forecast.
 */
import type { DepotFeedEnvelope } from '../api';
import type { HistoryScope, MetricKey, SeriesAnchor, SeriesPoint } from '../sim/types';
import type { MetricKind } from './config';
import type { TrendResult } from './trend';
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
