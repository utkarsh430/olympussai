/**
 * Fixed settings for forecasts and trend summaries. Everything a reviewer
 * might want to tune lives here, named, so no threshold hides in the maths.
 */
import { METRIC_RANGES, RATE_METRICS } from '../sim/history';
import type { MetricKey } from '../sim/types';
import { DEI_COMPONENTS } from '../score/config';
import type { DeiComponentKey } from '../score/types';

/** The weekly rhythm: depot operations repeat on a seven-day cycle. */
export const SEASON_DAYS = 7;
/** No forecast is drawn from fewer contiguous days than this. */
export const MIN_HISTORY_DAYS = 28;
export const DEFAULT_HORIZON_DAYS = 14;
/** Beyond four weeks the band is too wide to say anything useful. */
export const MAX_HORIZON_DAYS = 28;
/** Rolling-origin backtest: one-step-ahead forecasts over the last four weeks. */
export const BACKTEST_DAYS = 28;
/** Holt-Winters must beat seasonal-naive by more than this share of its error. */
export const METHOD_MARGIN = 0.05;
/** The band is this quantile of the chosen method's absolute backtest residuals. */
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

export interface ValidRange {
  readonly min: number;
  readonly max: number;
}

export function validRangeOf(metric: MetricKey): ValidRange {
  const { min, max } = METRIC_RANGES[metric];
  return { min, max };
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
