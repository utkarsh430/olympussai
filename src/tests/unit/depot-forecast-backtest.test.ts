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
    expect(forecast.seasonalNaiveMae).toBeCloseTo(7 * 0.3, 9);
    expect(forecast.holtWintersMae).toBeLessThan(TOLERANCE);
    expect(forecast.backtestMae).toBe(forecast.holtWintersMae);
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

  it('does not offer Holt-Winters with fewer than two full weeks before the backtest window', () => {
    const short = okOf(forecastSeries(seriesOf(trendPlusRhythm(41, 30, 0.3)), 'index'));
    expect(short.method).toBe('seasonal_naive');
    expect(short.reason).toBe('short_history');
    expect(short.holtWintersMae).toBeNull();
    const enough = okOf(forecastSeries(seriesOf(trendPlusRhythm(42, 30, 0.3)), 'index'));
    expect(enough.method).toBe('holt_winters');
    expect(enough.holtWintersMae).not.toBeNull();
  });

  it('keeps the simpler method on an exact tie', () => {
    const constant = okOf(forecastSeries(seriesOf(Array(56).fill(63.5)), 'index'));
    expect([constant.method, constant.reason]).toEqual(['seasonal_naive', 'within_margin']);
    const pattern = trendPlusRhythm(56, 50, 0);
    const weekly = okOf(forecastSeries(seriesOf(pattern), 'index'));
    expect([weekly.method, weekly.reason]).toEqual(['seasonal_naive', 'within_margin']);
  });

  it('breaks grid ties towards the smallest alpha, then beta, then gamma', () => {
    expect(bestHoltWinters(Array(56).fill(40))?.params).toEqual({
      alpha: ALPHA_GRID[0],
      beta: BETA_GRID[0],
      gamma: GAMMA_GRID[0],
    });
  });

  it('picks the grid point with the lowest backtest error', () => {
    const rng = new SeededRandom(seedFor('forecast-grid', START, 'noise'));
    const values = trendPlusRhythm(84, 40, 0.1).map((v) => v + rng.float(-3, 3));
    const best = bestHoltWinters(values);
    if (best === null) throw new Error('expected a fit');
    GRID.forEach((params) => {
      const score = backtestHoltWinters(values, params);
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
      const naive = backtestSeasonalNaive(values).mae;
      const hw = bestHoltWinters(values)?.score.mae ?? Infinity;
      expect(forecast.seasonalNaiveMae).toBe(naive);
      expect(forecast.holtWintersMae).toBe(hw);
      expect(forecast.method === 'holt_winters').toBe(hw < naive * 0.95);
      return { ratio: hw / naive, method: forecast.method };
    });
    const nearTies = outcomes.filter((o) => o.ratio >= 0.95 && o.ratio < 1);
    expect(nearTies.length).toBeGreaterThan(0);
    nearTies.forEach((o) => expect(o.method).toBe('seasonal_naive'));
  });
});

describe('Holt-Winters against the valid range', () => {
  it('clips a rate forecast that would climb past 1, band and all', () => {
    const values = trendPlusRhythm(49, 0, 0).map((s, t) => 0.8 + 0.004 * t + s / 1000);
    const forecast = okOf(forecastSeries(seriesOf(values), 'onRoadShare'));
    expect(forecast.method).toBe('holt_winters');
    const lastPoint = forecast.points.at(-1);
    expect(lastPoint).toEqual({ date: dateAt(62), value: 1, low: 1, high: 1 });
    forecast.points.forEach((p) => expect(p.high).toBeLessThanOrEqual(1));
  });

  it('clips a falling count at zero and keeps whole numbers', () => {
    const values = trendPlusRhythm(49, 70, -1.2).map(Math.round);
    const forecast = okOf(forecastSeries(seriesOf(values), 'available'));
    expect(forecast.method).toBe('holt_winters');
    expect(forecast.points.at(-1)).toMatchObject({ value: 0, low: 0 });
    forecast.points.forEach((p) => {
      expect(p.low).toBeGreaterThanOrEqual(0);
      [p.value, p.low, p.high].forEach((v) => expect(Number.isInteger(v)).toBe(true));
    });
  });
});
