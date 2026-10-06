/**
 * Holt-Winters additive smoothing with a weekly season: a level, a trend and
 * one term per weekday, each updated a little by every new day.
 *
 * Initialisation (classical decomposition of the first two seasons): the trend
 * is the difference between the two seasons' means divided by the season
 * length; the level is the first season's mean moved back by the trend to
 * just before day 0; each weekday's term is the average, over both seasons,
 * of that day's distance from its season's mean after removing the trend
 * within the season. A series that is exactly trend plus a weekly rhythm is
 * therefore reproduced exactly, whatever the smoothing parameters.
 *
 * Updates (Winters' additive form), for each day t with season length m:
 *   level_t    = alpha (y_t - s_{t-m}) + (1 - alpha) (level_{t-1} + trend_{t-1})
 *   trend_t    = beta (level_t - level_{t-1}) + (1 - beta) trend_{t-1}
 *   s_t        = gamma (y_t - level_t) + (1 - gamma) s_{t-m}
 * and the forecast h days after the last day n is level_n + h trend_n + s_{n+h-m}.
 */
import { SEASON_DAYS } from './config';

export interface HoltWintersParams {
  readonly alpha: number;
  readonly beta: number;
  readonly gamma: number;
}

export interface HoltWintersState {
  readonly level: number;
  readonly trend: number;
  /** One term per day of the coming season: index 0 is the next day. */
  readonly seasonals: readonly number[];
}

export interface HoltWintersFit {
  /** State after the last value. */
  readonly state: HoltWintersState;
  /** For each day, the forecast made from the days before it alone. */
  readonly oneStep: readonly number[];
  /**
   * When asked for: for each origin day o from `PathRequest.from` on, the
   * forecasts of days o, o+1, ... made from the days before o alone (entry
   * o - from). Empty otherwise.
   */
  readonly paths: readonly (readonly number[])[];
}

/** Rolling-origin paths to record while fitting. */
export interface PathRequest {
  readonly from: number;
  readonly horizon: number;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** The state just before day 0, or null with fewer than two full seasons. */
export function initialHoltWinters(
  values: readonly number[],
  season: number = SEASON_DAYS,
): HoltWintersState | null {
  if (values.length < 2 * season) return null;
  const first = values.slice(0, season);
  const second = values.slice(season, 2 * season);
  const firstMean = mean(first);
  const secondMean = mean(second);
  const trend = (secondMean - firstMean) / season;
  const centre = (season - 1) / 2;
  const seasonals = Array.from({ length: season }, (_, i) => {
    const offset = trend * (i - centre);
    const fromFirst = (first[i] as number) - firstMean - offset;
    const fromSecond = (second[i] as number) - secondMean - offset;
    return (fromFirst + fromSecond) / 2;
  });
  // The first season's mean sits at its centre day; step back to day -1.
  return { level: firstMean - trend * (centre + 1), trend, seasonals };
}

/**
 * Runs the smoothing over every value. Because each one-step forecast uses
 * only earlier days (the initial state reads days 0-13, and the backtest
 * scores only later days), a single pass yields the rolling-origin forecasts.
 */
export function fitHoltWinters(
  values: readonly number[],
  params: HoltWintersParams,
  season: number = SEASON_DAYS,
  pathRequest: PathRequest | null = null,
): HoltWintersFit | null {
  const initial = initialHoltWinters(values, season);
  if (initial === null) return null;
  const { alpha, beta, gamma } = params;
  const seasonals = [...initial.seasonals];
  let level = initial.level;
  let trend = initial.trend;
  const paths: number[][] = [];
  const oneStep = values.map((y, t) => {
    if (pathRequest !== null && t >= pathRequest.from) {
      // h days ahead of origin t lands on day t + h - 1, whose weekday term
      // is the latest one already updated for that slot.
      const { horizon } = pathRequest;
      paths.push(
        Array.from(
          { length: horizon },
          (_, i) => level + (i + 1) * trend + (seasonals[(t + i) % season] as number),
        ),
      );
    }
    const slot = t % season;
    const seasonal = seasonals[slot] as number;
    const predicted = level + trend + seasonal;
    const nextLevel = alpha * (y - seasonal) + (1 - alpha) * (level + trend);
    trend = beta * (nextLevel - level) + (1 - beta) * trend;
    level = nextLevel;
    seasonals[slot] = gamma * (y - level) + (1 - gamma) * seasonal;
    return predicted;
  });
  const next = values.length % season;
  const rotated = [...seasonals.slice(next), ...seasonals.slice(0, next)];
  return { state: { level, trend, seasonals: rotated }, oneStep, paths };
}

/** The next `horizon` days from a fitted state. */
export function holtWintersForecast(state: HoltWintersState, horizon: number): number[] {
  const season = state.seasonals.length;
  return Array.from(
    { length: horizon },
    (_, i) => state.level + (i + 1) * state.trend + (state.seasonals[i % season] as number),
  );
}
