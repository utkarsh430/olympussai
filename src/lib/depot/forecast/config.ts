/**
 * Fixed settings for forecasts and trend summaries. Everything a reviewer
 * might want to tune lives here, named, so no threshold hides in the maths.
 */
import { METRIC_RANGES, RATE_METRICS } from '../sim/history';
import type { MetricKey } from '../sim/types';
import { DEI_COMPONENTS } from '../score/config';
import type { DeiComponentKey } from '../score/types';
import type { TrendUnit } from './types';

/** The weekly rhythm: depot operations repeat on a seven-day cycle. */
export const SEASON_DAYS = 7;
/** No forecast is drawn from fewer contiguous days than this. */
export const MIN_HISTORY_DAYS = 28;
export const DEFAULT_HORIZON_DAYS = 14;
/** Beyond four weeks the band is too wide to say anything useful. */
export const MAX_HORIZON_DAYS = 28;
/** Rolling-origin backtest: the last four weeks are forecast 1 to H days ahead. */
export const BACKTEST_DAYS = 28;
/**
 * Fewest errors one days-ahead figure (its error and its band) is read from.
 * A thinner horizon borrows its neighbours' errors; see `pooledErrors`.
 */
export const MIN_BAND_SAMPLES = 10;
/** Holt-Winters must beat seasonal-naive by more than this share of its error. */
export const METHOD_MARGIN = 0.05;
/** The band h days ahead is this quantile of the chosen method's absolute h-step errors. */
export const BAND_QUANTILE = 0.8;

/**
 * Holt-Winters smoothing grid. Searched alpha, then beta, then gamma, each
 * ascending; a later combination replaces the best only when strictly better,
 * so a tie keeps the smallest parameters in that order.
 */
export const ALPHA_GRID: readonly number[] = [0.1, 0.2, 0.4];
export const BETA_GRID: readonly number[] = [0.01, 0.05, 0.1];
export const GAMMA_GRID: readonly number[] = [0.05, 0.1, 0.3];

/** How a metric is measured, which sets its unit, rounding and dead-band. */
export type MetricKind = 'rate' | 'index' | 'count';

/**
 * Read from the history model rather than restated: a rate is one of its rate
 * metrics, a count is stored with no decimals, and the index is what is left.
 */
export function metricKindOf(metric: MetricKey): MetricKind {
  if (RATE_METRICS.has(metric)) return 'rate';
  return METRIC_RANGES[metric].decimals === 0 ? 'count' : 'index';
}

/** The unit each kind is stated in; a rate is stored as a fraction but stated in points. */
export const UNIT_OF_KIND: Readonly<Record<MetricKind, TrendUnit>> = {
  rate: 'percentage_points',
  index: 'points',
  count: 'buses',
};

export interface ValidRange {
  readonly min: number;
  readonly max: number;
}

export function validRangeOf(metric: MetricKey): ValidRange {
  const { min, max } = METRIC_RANGES[metric];
  return { min, max };
}

/**
 * No depot or network holds anywhere near this many buses (the state fleet is
 * a few thousand), so a larger count is a feed fault, not a reading. It also
 * keeps every error sum finite.
 */
export const COUNT_SANE_MAX = 100_000;

/** What a series must satisfy before any forecast or trend reads it. */
export interface SeriesRules {
  readonly min: number;
  /** Always finite: an unbounded count is capped at `COUNT_SANE_MAX`. */
  readonly max: number;
  /** Counts of buses are whole numbers. */
  readonly wholeNumbers: boolean;
}

export function seriesRulesOf(metric: MetricKey): SeriesRules {
  const { min, max } = validRangeOf(metric);
  const wholeNumbers = metricKindOf(metric) === 'count';
  return { min, max: Number.isFinite(max) ? max : COUNT_SANE_MAX, wholeNumbers };
}

/** Changes smaller than this, in the metric's own unit, read as steady. */
export const STEADY_BAND: Readonly<Record<MetricKind, number>> = {
  rate: 0.5, // percentage points
  index: 1, // points
  count: 2, // buses
};

/** The index component each rate metric measures; its direction is read from there. */
const COMPONENT_OF: Readonly<Partial<Record<MetricKey, DeiComponentKey>>> = {
  onRoadShare: 'onRoad',
  offRoadRate: 'offRoad',
  darkRate: 'dark',
};

/**
 * Whether a rise is good news. Rates take their direction from the index
 * configuration so a trend can never read the opposite way to the ranking;
 * the index itself and the count of available buses are better when higher.
 */
export function higherIsBetter(metric: MetricKey): boolean {
  const component = COMPONENT_OF[metric];
  if (component === undefined) return true;
  const config = DEI_COMPONENTS.find((c) => c.key === component);
  if (config === undefined) throw new RangeError(`No index component for ${metric}`);
  return config.higherIsBetter;
}
