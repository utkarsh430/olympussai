import { describe, expect, it } from 'vitest';
import {
  backtestHoltWinters,
  backtestSeasonalNaive,
  bestHoltWinters,
  chooseMethod,
} from '@/lib/depot/forecast/backtest';
import { ALPHA_GRID, BETA_GRID, GAMMA_GRID } from '@/lib/depot/forecast/config';
import { forecastSeries } from '@/lib/depot/forecast/forecast';
import {
  fitHoltWinters,
  holtWintersForecast,
  initialHoltWinters,
} from '@/lib/depot/forecast/holtWinters';
import type { Forecast, ForecastResult } from '@/lib/depot/forecast/types';
import { seedFor } from '@/lib/depot/sim/seed';
import type { SeriesPoint } from '@/lib/depot/sim/types';
import { SeededRandom } from '@/lib/simulation/seededRandom';

const DAY = 86_400_000;
const START = '2026-01-05';
/** A weekly rhythm that sums to zero, so the level is the weekly mean. */
const RHYTHM = [2, 4, 6, 3, 1, -7, -9];
/** Known-answer tolerance for Holt-Winters on an exact trend-plus-rhythm series. */
const TOLERANCE = 1e-6;
const GRID = ALPHA_GRID.flatMap((alpha) =>
  BETA_GRID.flatMap((beta) => GAMMA_GRID.map((gamma) => ({ alpha, beta, gamma }))),
);

function dateAt(i: number): string {
  return new Date(Date.parse(`${START}T00:00:00Z`) + i * DAY).toISOString().slice(0, 10);
}

function seriesOf(values: readonly number[]): SeriesPoint[] {
  return values.map((value, i) => ({ date: dateAt(i), value }));
}

function trendPlusRhythm(n: number, level: number, slope: number): number[] {
  return Array.from({ length: n }, (_, t) => level + slope * t + (RHYTHM[t % 7] as number));
}

function okOf(result: ForecastResult): Forecast {
  if (result.status !== 'ok') throw new Error(`expected a forecast, got ${result.status}`);
  return result.forecast;
}

describe('Holt-Winters additive', () => {
  it('initialises level, trend and weekday terms exactly from the first two weeks', () => {
    const state = initialHoltWinters(trendPlusRhythm(14, 30, 0.3));
    expect(state).not.toBeNull();
    expect(state?.level).toBeCloseTo(30 - 0.3, 12);
    expect(state?.trend).toBeCloseTo(0.3, 12);
    state?.seasonals.forEach((s, i) => expect(s).toBeCloseTo(RHYTHM[i] as number, 12));
  });

  it('cannot start from less than two full weeks', () => {
    expect(initialHoltWinters(trendPlusRhythm(13, 30, 0.3))).toBeNull();
    const params = { alpha: 0.2, beta: 0.05, gamma: 0.1 };
    expect(fitHoltWinters(trendPlusRhythm(13, 30, 0.3), params)).toBeNull();
  });

  it.each(GRID)('tracks and extrapolates trend plus rhythm with %o', (params) => {
    const values = trendPlusRhythm(49, 30, 0.3);
    const fit = fitHoltWinters(values, params);
    if (fit === null) throw new Error('expected a fit');
    fit.oneStep.forEach((p, t) => expect(Math.abs(p - (values[t] as number))).toBeLessThan(TOLERANCE));
    const truth = trendPlusRhythm(49 + 14, 30, 0.3).slice(49);
    holtWintersForecast(fit.state, 14).forEach((v, i) =>
      expect(Math.abs(v - (truth[i] as number))).toBeLessThan(TOLERANCE),
    );
  });

  it('chooses Holt-Winters for trend plus rhythm, within tolerance, beating the baseline', () => {
    const forecast = okOf(forecastSeries(seriesOf(trendPlusRhythm(70, 30, 0.3)), 'index'));
    expect(forecast.method).toBe('holt_winters');
    expect(forecast.reason).toBe('holt_winters_better');
    expect(forecast.backtestDays).toBe(28);
    // Seasonal-naive misses by one week's trend up to 7 days ahead, two weeks' after.
    expect(forecast.seasonalNaiveError).toBeCloseTo((7 * 0.3 + 14 * 0.3) / 2, 9);
    expect(forecast.holtWintersError).toBeLessThan(TOLERANCE);
    expect(forecast.error).toEqual({
      overHorizon: forecast.holtWintersError,
      byDaysAhead: expect.any(Array),
      unit: 'points',
      statedAsFraction: false,
    });
    expect(forecast.error.byDaysAhead).toHaveLength(14);
    const truth = trendPlusRhythm(84, 30, 0.3).slice(70);
    forecast.points.forEach((p, i) => {
      expect(Math.abs(p.value - (truth[i] as number))).toBeLessThan(TOLERANCE);
      expect(p.high - p.low).toBeLessThan(TOLERANCE);
    });
  });
});

describe('method choice', () => {
  it.each([
    [1, null, 'seasonal_naive', 'short_history'],
    [0, 0, 'seasonal_naive', 'within_margin'],
    [1, 1, 'seasonal_naive', 'within_margin'],
    [1, 0.96, 'seasonal_naive', 'within_margin'],
    [1, 0.95, 'seasonal_naive', 'within_margin'],
    [1, 0.9499, 'holt_winters', 'holt_winters_better'],
    [2, 0, 'holt_winters', 'holt_winters_better'],
  ] as const)('baseline %s vs Holt-Winters %s: %s (%s)', (naive, hw, method, reason) => {
    expect(chooseMethod(naive, hw)).toEqual({ method, reason });
  });

  it.each([
    [14, 54],
    [7, 47],
    [28, 68],
  ])('at %s days ahead, offers Holt-Winters only after two weeks before every scored origin (%s days is short)', (horizon, short) => {
    const tooShort = okOf(forecastSeries(seriesOf(trendPlusRhythm(short, 30, 0.3)), 'index', horizon));
    expect(tooShort.method).toBe('seasonal_naive');
    expect(tooShort.reason).toBe('short_history');
    expect(tooShort.holtWintersError).toBeNull();
    const enough = okOf(forecastSeries(seriesOf(trendPlusRhythm(short + 1, 30, 0.3)), 'index', horizon));
    expect(enough.method).toBe('holt_winters');
    expect(enough.holtWintersError).not.toBeNull();
  });

  it('keeps the simpler method on an exact tie', () => {
    const constant = okOf(forecastSeries(seriesOf(Array(56).fill(63.5)), 'index'));
    expect([constant.method, constant.reason]).toEqual(['seasonal_naive', 'within_margin']);
    const pattern = trendPlusRhythm(56, 50, 0);
    const weekly = okOf(forecastSeries(seriesOf(pattern), 'index'));
    expect([weekly.method, weekly.reason]).toEqual(['seasonal_naive', 'within_margin']);
  });

  it('breaks grid ties towards the smallest alpha, then beta, then gamma', () => {
    expect(bestHoltWinters(Array(56).fill(40), 14)?.params).toEqual({
      alpha: ALPHA_GRID[0],
      beta: BETA_GRID[0],
      gamma: GAMMA_GRID[0],
    });
  });

  it('picks the grid point with the lowest backtest error', () => {
    const rng = new SeededRandom(seedFor('forecast-grid', START, 'noise'));
    const values = trendPlusRhythm(84, 40, 0.1).map((v) => v + rng.float(-3, 3));
    const best = bestHoltWinters(values, 14);
    if (best === null) throw new Error('expected a fit');
    GRID.forEach((params) => {
      const score = backtestHoltWinters(values, params, 14);
      expect(best.score.mae).toBeLessThanOrEqual(score?.mae ?? Infinity);
    });
  });

  /*
   * On white noise Holt-Winters is a smoother and seasonal-naive repeats last
   * week's noise, so Holt-Winters is usually genuinely better (about a quarter
   * lower error) and is rightly chosen. What must never happen is a win by a
   * hair: the near-ties in this seeded sample have to stay with the baseline.
   */
  it('on white noise, keeps the baseline unless Holt-Winters clears the margin', () => {
    const outcomes = Array.from({ length: 40 }, (_, i) => {
      const rng = new SeededRandom(seedFor('forecast-noise', START, `series:${i}`));
      const values = Array.from({ length: rng.int(42, 120) }, () => 60 + rng.float(-4, 4));
      const forecast = okOf(forecastSeries(seriesOf(values), 'index'));
      const naive = backtestSeasonalNaive(values, 14).mae;
      const hw = bestHoltWinters(values, 14)?.score.mae ?? Infinity;
      expect(forecast.seasonalNaiveError).toBe(naive);
      expect(forecast.holtWintersError ?? Infinity).toBe(hw);
      expect(forecast.method === 'holt_winters').toBe(hw < naive * 0.95);
      return { ratio: hw / naive, method: forecast.method };
    });
    // Scored over two weeks ahead, the sample holds both outcomes.
    const kept = outcomes.filter((o) => o.ratio >= 0.95);
    expect(kept.length).toBeGreaterThan(0);
    kept.forEach((o) => expect(o.method).toBe('seasonal_naive'));
    expect(outcomes.some((o) => o.method === 'holt_winters')).toBe(true);
  });
});

describe('Holt-Winters against the valid range', () => {
  it('clips a rate climbing past 1 first, and keeps its band on the inner side', () => {
    const rng = new SeededRandom(seedFor('forecast-edge', START, 'rate'));
    const values = trendPlusRhythm(63, 0, 0).map((s, t) => 0.65 + 0.005 * t + s / 1000 + rng.float(-0.002, 0.002));
    const forecast = okOf(forecastSeries(seriesOf(values), 'onRoadShare'));
    expect(forecast.method).toBe('holt_winters');
    const lastPoint = forecast.points.at(-1);
    expect(lastPoint).toMatchObject({ date: dateAt(76), value: 1, high: 1 });
    expect(1 - (lastPoint?.low ?? 1)).toBeGreaterThan(0.001);
    forecast.points.forEach((p) => {
      expect(p.high).toBeLessThanOrEqual(1);
      expect(p.high).toBeGreaterThan(p.low);
    });
  });

  it('clips a falling count at zero and keeps whole numbers', () => {
    const values = trendPlusRhythm(63, 90, -1.2).map(Math.round);
    const forecast = okOf(forecastSeries(seriesOf(values), 'available'));
    expect(forecast.method).toBe('holt_winters');
    expect(forecast.points.at(-1)).toMatchObject({ value: 0, low: 0 });
    expect(forecast.points.at(-1)?.high).toBeGreaterThan(0);
    forecast.points.forEach((p) => {
      expect(p.low).toBeGreaterThanOrEqual(0);
      [p.value, p.low, p.high].forEach((v) => expect(Number.isInteger(v)).toBe(true));
    });
  });
});
