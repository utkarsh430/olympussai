/**
 * Known answers from an independent reference. Everything below the imports
 * is written from the textbook, separately from the production code: additive
 * Holt-Winters (Winters' form, classical two-season start) run afresh on each
 * history prefix, a plain rolling-origin backtest over 1..H days ahead, the
 * pooling rule, a nearest-rank 80th percentile and clip-then-band. The series
 * are noisy and their lengths are not multiples of seven, so a swapped
 * smoothing weight, a missing weekday rotation, a one-week start, an
 * off-by-one in the scored window or a different band quantile all show.
 */
import { describe, expect, it } from 'vitest';
import { forecastSeries } from '@/lib/depot/forecast/forecast';
import type { Forecast } from '@/lib/depot/forecast/types';
import type { MetricKey } from '@/lib/depot/sim/types';

const M = 7;
const GRID_A = [0.1, 0.2, 0.4];
const GRID_B = [0.01, 0.05, 0.1];
const GRID_G = [0.05, 0.1, 0.3];
const TOL = 1e-9;

/** Textbook additive Holt-Winters; returns the h = 1..H path after the last value. */
function refHoltWinters(
  y: readonly number[],
  a: number,
  b: number,
  g: number,
  H: number,
): number[] {
  const mean = (xs: readonly number[]): number => xs.reduce((s, v) => s + v, 0) / xs.length;
  const m1 = mean(y.slice(0, M));
  const m2 = mean(y.slice(M, 2 * M));
  const b0 = (m2 - m1) / M;
  const c = (M - 1) / 2;
  const season: number[] = []; // season[t] for absolute day t; days -7..-1 at t + 7 offset below
  const init: number[] = [];
  for (let i = 0; i < M; i += 1) {
    init.push(
      ((y[i] as number) - (m1 + b0 * (i - c)) + ((y[M + i] as number) - (m2 + b0 * (i - c)))) / 2,
    );
  }
  const s = (t: number): number => (t < 0 ? (init[t + M] as number) : (season[t] as number));
  let level = m1 - b0 * (c + 1);
  let trend = b0;
  for (let t = 0; t < y.length; t += 1) {
    const prior = s(t - M);
    const nextLevel = a * ((y[t] as number) - prior) + (1 - a) * (level + trend);
    trend = b * (nextLevel - level) + (1 - b) * trend;
    level = nextLevel;
    season[t] = g * ((y[t] as number) - level) + (1 - g) * prior;
  }
  const n = y.length;
  return Array.from({ length: H }, (_, k) => {
    const h = k + 1;
    return level + h * trend + s(n + h - 1 - M * Math.ceil(h / M));
  });
}

function refNaivePath(y: readonly number[], H: number): number[] {
  const n = y.length;
  return Array.from({ length: H }, (_, k) => y[n - M + (k % M)] as number);
}

/** Per days ahead, the absolute errors of `path` forecasts of the last four weeks. */
function refErrors(
  y: readonly number[],
  H: number,
  path: (prefix: readonly number[]) => number[],
): number[][] {
  const n = y.length;
  const window = Math.min(28, n - M);
  const minOrigin = n - 28 - (H - 1) >= 2 * M ? 2 * M : M;
  const out: number[][] = [];
  for (let h = 1; h <= H; h += 1) {
    const errs: number[] = [];
    for (let t = n - window; t < n; t += 1) {
      const origin = t - h + 1;
      if (origin >= minOrigin)
        errs.push(Math.abs((y[t] as number) - (path(y.slice(0, origin))[h - 1] as number)));
    }
    out.push(errs);
  }
  // Pool: borrow whole horizons by distance, the longer first on a tie, up to ten errors.
  return out.map((own, i) => {
    if (own.length >= 10) return own;
    const pooled = [...own];
    for (let d = 1; d < H && pooled.length < 10; d += 1) {
      if (i + d < H) pooled.push(...(out[i + d] as number[]));
      if (pooled.length < 10 && i - d >= 0) pooled.push(...(out[i - d] as number[]));
    }
    return pooled;
  });
}

function score(errors: number[][]): { byDay: number[]; mae: number } {
  const byDay = errors.map((e) => e.reduce((s, v) => s + v, 0) / e.length);
  return { byDay, mae: byDay.reduce((s, v) => s + v, 0) / byDay.length };
}

function q80(xs: readonly number[]): number {
  const sorted = [...xs].sort((p, q) => p - q);
  const value = sorted[Math.ceil(0.8 * sorted.length) - 1] as number;
  if (value > 0) return value;
  const nonZero = xs.filter((x) => x > 0);
  return nonZero.length === 0 ? 0 : Math.min(...nonZero);
}

interface RefResult {
  readonly method: string;
  readonly values: number[];
  readonly errors: number[][];
  readonly naive: number;
  readonly hw: number | null;
}

function reference(y: readonly number[], H: number): RefResult {
  const naiveErr = refErrors(y, H, (p) => refNaivePath(p, H));
  const naive = score(naiveErr).mae;
  let best: { a: number; b: number; g: number; errs: number[][]; mae: number } | null = null;
  if (y.length - 28 - (H - 1) >= 2 * M) {
    for (const a of GRID_A)
      for (const b of GRID_B)
        for (const g of GRID_G) {
          const errs = refErrors(y, H, (p) => refHoltWinters(p, a, b, g, H));
          const mae = score(errs).mae;
          if (best === null || mae < best.mae) best = { a, b, g, errs, mae };
        }
  }
  if (best !== null && best.mae < naive * 0.95) {
    const values = refHoltWinters(y, best.a, best.b, best.g, H);
    return { method: 'holt_winters', values, errors: best.errs, naive, hw: best.mae };
  }
  return {
    method: 'seasonal_naive',
    values: refNaivePath(y, H),
    errors: naiveErr,
    naive,
    hw: best?.mae ?? null,
  };
}

function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

function noisy(n: number, seed: number, slope: number, scale: number, base: number): number[] {
  const r = lcg(seed);
  const week = [1.5, 0.5, 0, -0.5, 1, -2.5, -3];
  return Array.from(
    { length: n },
    (_, t) => base + scale * (slope * t + (week[t % 7] as number) + 3 * (r() - 0.5)),
  );
}

const dateAt = (i: number): string =>
  new Date(Date.parse('2026-02-03T00:00:00Z') + i * 86_400_000).toISOString().slice(0, 10);

function run(values: readonly number[], metric: MetricKey, H: number): Forecast {
  const result = forecastSeries(
    values.map((value, i) => ({ date: dateAt(i), value })),
    metric,
    H,
  );
  if (result.status !== 'ok') throw new Error(result.status);
  return result.forecast;
}

const CASES = [
  { name: 'noise, 45 days, two weeks', values: noisy(45, 7, 0, 1, 60), metric: 'index', H: 14 },
  { name: 'noise, 60 days, two weeks', values: noisy(60, 11, 0, 1, 60), metric: 'index', H: 14 },
  { name: 'trend, 60 days, two weeks', values: noisy(60, 13, 0.6, 1, 30), metric: 'index', H: 14 },
  { name: 'trend, 74 days, one week', values: noisy(74, 17, -0.4, 1, 70), metric: 'index', H: 7 },
  {
    name: 'rate near 1, 66 days',
    values: noisy(66, 19, 1, 0.004, 0.7),
    metric: 'onRoadShare',
    H: 14,
  },
  {
    name: 'thin horizons, 30 days, four weeks',
    values: noisy(30, 23, 0, 1, 60),
    metric: 'index',
    H: 28,
  },
] as const;

describe('forecast against an independent reference', () => {
  it.each(CASES)('$name', ({ values, metric, H }) => {
    const max = metric === 'index' ? 100 : 1;
    const ref = reference(values, H);
    const forecast = run(values, metric, H);
    expect(forecast.method).toBe(ref.method);
    expect(Math.abs(forecast.seasonalNaiveError - ref.naive)).toBeLessThan(TOL);
    if (ref.hw === null) expect(forecast.holtWintersError).toBeNull();
    else expect(Math.abs((forecast.holtWintersError ?? NaN) - ref.hw)).toBeLessThan(TOL);
    const byDay = score(ref.errors).byDay;
    forecast.error.byDaysAhead.forEach((e, i) =>
      expect(Math.abs(e - (byDay[i] as number))).toBeLessThan(TOL),
    );
    forecast.points.forEach((p, i) => {
      const value = Math.min(max, Math.max(0, ref.values[i] as number));
      const half = q80(ref.errors[i] as number[]);
      expect(Math.abs(p.value - value)).toBeLessThan(TOL);
      expect(Math.abs(p.low - Math.max(0, value - half))).toBeLessThan(TOL);
      expect(Math.abs(p.high - Math.min(max, value + half))).toBeLessThan(TOL);
    });
  });

  it('covers both methods, a forecast that reaches the range edge, and pooled horizons', () => {
    const methods = CASES.map((c) => reference(c.values, c.H).method);
    expect(methods).toContain('holt_winters');
    expect(methods).toContain('seasonal_naive');
    const rate = CASES[4];
    expect(run(rate.values, rate.metric, rate.H).points.some((p) => p.value === 1)).toBe(true);
    const thin = CASES[5];
    expect(
      refErrors(thin.values, thin.H, (p) => refNaivePath(p, thin.H)).at(-1)?.length,
    ).toBeGreaterThanOrEqual(10);
  });

  it('bands by the nearest-rank 80th percentile of distinct errors', () => {
    const { values, metric, H } = CASES[1];
    const ref = reference(values, H);
    const errs = ref.errors[0] as number[];
    expect(new Set(errs).size).toBe(errs.length);
    const sorted = [...errs].sort((p, q) => p - q);
    const p = run(values, metric, H).points[0];
    // The ceiling rank, not the floor rank and not the 90th percentile.
    expect(
      Math.abs(
        (p?.high ?? 0) - (p?.value ?? 0) - (sorted[Math.ceil(0.8 * sorted.length) - 1] as number),
      ),
    ).toBeLessThan(TOL);
    expect(sorted[Math.floor(0.8 * sorted.length) - 1]).not.toBe(
      sorted[Math.ceil(0.8 * sorted.length) - 1],
    );
  });
});
