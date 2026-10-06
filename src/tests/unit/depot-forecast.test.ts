import { describe, expect, it } from 'vitest';
import { forecastSeries } from '@/lib/depot/forecast/forecast';
import { COUNT_SANE_MAX, DEFAULT_HORIZON_DAYS, MIN_HISTORY_DAYS } from '@/lib/depot/forecast/config';
import type { Forecast, ForecastResult } from '@/lib/depot/forecast/types';
import { seedFor } from '@/lib/depot/sim/seed';
import type { MetricKey, SeriesPoint } from '@/lib/depot/sim/types';
import { SeededRandom } from '@/lib/simulation/seededRandom';

const DAY = 86_400_000;
const START = '2026-01-05';
const WEEK = [50, 52, 55, 53, 51, 40, 38];
const METRICS: readonly MetricKey[] = ['onRoadShare', 'offRoadRate', 'darkRate', 'index', 'available'];
const RANGE: Record<MetricKey, readonly [number, number]> = {
  onRoadShare: [0, 1],
  offRoadRate: [0, 1],
  darkRate: [0, 1],
  index: [0, 100],
  available: [0, Number.POSITIVE_INFINITY],
};

function dateAt(i: number, start = START): string {
  return new Date(Date.parse(`${start}T00:00:00Z`) + i * DAY).toISOString().slice(0, 10);
}

function seriesOf(values: readonly number[]): SeriesPoint[] {
  return values.map((value, i) => ({ date: dateAt(i), value }));
}

function weekly(n: number): number[] {
  return Array.from({ length: n }, (_, i) => WEEK[i % 7] as number);
}

function okOf(result: ForecastResult): Forecast {
  if (result.status !== 'ok') throw new Error(`expected a forecast, got ${result.status}`);
  return result.forecast;
}

describe('forecastSeries input rules', () => {
  const good = seriesOf(weekly(35));

  it.each([
    ['non_finite_value', [...good.slice(0, 34), { date: dateAt(34), value: Number.NaN }]],
    ['non_finite_value', [...good.slice(0, 34), { date: dateAt(34), value: Infinity }]],
    ['invalid_date', [...good.slice(0, 34), { date: '2026-02-30', value: 50 }]],
    ['invalid_date', [...good.slice(0, 34), { date: '8 Feb 2026', value: 50 }]],
    ['duplicate_date', [...good, { date: dateAt(3), value: 50 }]],
    ['out_of_range', [...good.slice(0, 34), { date: dateAt(34), value: 101 }]],
  ])('reports %s instead of throwing', (reason, series) => {
    expect(forecastSeries(series, 'index')).toEqual({ status: 'invalid_input', reason });
  });

  it.each([
    ['non_integer_count', 10.4],
    ['out_of_range', COUNT_SANE_MAX + 1],
    ['out_of_range', 1e308],
  ])('refuses a bus count with %s (%s)', (reason, value) => {
    const counts = seriesOf(weekly(35)).map((p) => ({ ...p, value: Math.round(p.value) }));
    const series = [...counts.slice(0, 34), { date: dateAt(34), value }];
    expect(forecastSeries(series, 'available')).toEqual({ status: 'invalid_input', reason });
  });

  it('accepts a whole bus count up to the sane maximum', () => {
    const counts = seriesOf(weekly(35)).map((p, i) => ({ ...p, value: i === 34 ? COUNT_SANE_MAX : 50 }));
    expect(forecastSeries(counts, 'available').status).toBe('ok');
  });

  it.each([0, -1, 1.5, 29, Number.NaN])('rejects a horizon of %s days', (horizon) => {
    expect(forecastSeries(good, 'index', horizon)).toEqual({
      status: 'invalid_input',
      reason: 'invalid_horizon',
    });
  });

  it('defaults to a fourteen-day horizon', () => {
    expect(okOf(forecastSeries(good, 'index')).points).toHaveLength(DEFAULT_HORIZON_DAYS);
  });

  it('needs at least 28 days of history', () => {
    expect(forecastSeries(seriesOf(weekly(27)), 'index')).toEqual({
      status: 'insufficient_history',
      historyDays: 27,
      required: MIN_HISTORY_DAYS,
      cause: 'short_record',
      missingDate: null,
    });
    expect(forecastSeries([], 'index')).toEqual({
      status: 'insufficient_history',
      historyDays: 0,
      required: MIN_HISTORY_DAYS,
      cause: 'short_record',
      missingDate: null,
    });
    expect(okOf(forecastSeries(seriesOf(weekly(28)), 'index')).historyDays).toBe(28);
  });

  it('counts only the contiguous run ending on the latest date; a missing day is never filled', () => {
    const full = seriesOf(weekly(40));
    const recentGap = full.filter((_, i) => i !== 29);
    expect(forecastSeries(recentGap, 'index')).toEqual({
      status: 'insufficient_history',
      historyDays: 10,
      required: MIN_HISTORY_DAYS,
      cause: 'gap',
      missingDate: dateAt(29),
    });
    const oldGap = full.filter((_, i) => i !== 5);
    const result = okOf(forecastSeries(oldGap, 'index'));
    expect(result.historyDays).toBe(34);
    expect(result).toEqual(okOf(forecastSeries(full.slice(6), 'index')));
  });

  it('sorts unordered input by date', () => {
    const series = seriesOf(weekly(35));
    expect(forecastSeries([...series].reverse(), 'index')).toEqual(forecastSeries(series, 'index'));
  });
});

describe('seasonal-naive baseline', () => {
  it.each([35, 56])('forecasts a pure weekly pattern exactly (%s days)', (n) => {
    const forecast = okOf(forecastSeries(seriesOf(weekly(n)), 'index', 21));
    expect(forecast.method).toBe('seasonal_naive');
    expect(forecast.backtestMae).toBe(0);
    forecast.points.forEach((p, h) => {
      expect(p.date).toBe(dateAt(n + h));
      expect(p.value).toBe(WEEK[(n + h) % 7]);
      expect(p.low).toBe(p.value);
      expect(p.high).toBe(p.value);
    });
  });

  it.each([
    ['onRoadShare', 0],
    ['onRoadShare', 1],
    ['darkRate', 0.42],
    ['index', 0],
    ['index', 100],
    ['index', 63.5],
    ['available', 0],
    ['available', 120],
  ] as const)('forecasts a constant %s of %s with a zero-width band', (metric, level) => {
    const forecast = okOf(forecastSeries(seriesOf(Array(56).fill(level)), metric));
    expect(forecast.backtestMae).toBe(0);
    forecast.points.forEach((p) => {
      expect([p.value, p.low, p.high]).toEqual([level, level, level]);
    });
  });

  it('bands by the 80th-percentile absolute residual, widened by the square root of the horizon', () => {
    const n = 35;
    const values = weekly(n).map((v, i) => v + ((i * 37) % 11) - 5);
    const residuals = values.slice(7).map((v, i) => Math.abs(v - (values[i] as number)));
    const sorted = [...residuals].sort((a, b) => a - b);
    const q80 = sorted[Math.ceil(0.8 * sorted.length) - 1] as number;
    expect(q80).toBeGreaterThan(0);

    const forecast = okOf(forecastSeries(seriesOf(values), 'index', 14));
    expect(forecast.method).toBe('seasonal_naive');
    expect(forecast.backtestDays).toBe(28);
    forecast.points.forEach((p, i) => {
      const h = i + 1;
      expect(p.value).toBe(values[n - 7 + (i % 7)]);
      expect(p.high - p.value).toBeCloseTo(q80 * Math.sqrt(h), 9);
      expect(p.value - p.low).toBeCloseTo(q80 * Math.sqrt(h), 9);
    });
  });

  it('uses a shorter backtest when the history leaves less than four weeks after one season', () => {
    const forecast = okOf(forecastSeries(seriesOf(weekly(30)), 'index'));
    expect(forecast.backtestDays).toBe(23);
  });
});

describe('valid range', () => {
  it('clips a rate band at 1 and keeps rates unrounded', () => {
    const values = Array.from({ length: 35 }, (_, i) => [0.9987, 0.93, 0.97, 1, 0.95][i % 5] as number);
    const forecast = okOf(forecastSeries(seriesOf(values), 'onRoadShare'));
    expect(forecast.points.some((p) => p.high === 1)).toBe(true);
    expect(forecast.points.some((p) => p.value === 0.9987)).toBe(true);
    forecast.points.forEach((p) => {
      expect(p.high).toBeLessThanOrEqual(1);
      expect(p.low).toBeGreaterThanOrEqual(0);
    });
  });

  it('clips a count band at 0 and rounds counts to whole buses after clipping', () => {
    const values = Array.from({ length: 35 }, (_, i) => [0, 1, 3, 2, 0, 5, 1, 4][i % 8] as number);
    const forecast = okOf(forecastSeries(seriesOf(values), 'available'));
    expect(forecast.points.some((p) => p.low === 0 && p.value > 0)).toBe(true);
    forecast.points.forEach((p) => {
      [p.value, p.low, p.high].forEach((v) => expect(Number.isInteger(v)).toBe(true));
      expect(p.low).toBeGreaterThanOrEqual(0);
    });
  });

  it('clips an index band at 100', () => {
    const values = Array.from({ length: 35 }, (_, i) => [99.5, 92, 97, 100, 95][i % 5] as number);
    const forecast = okOf(forecastSeries(seriesOf(values), 'index'));
    expect(forecast.points.some((p) => p.high === 100)).toBe(true);
    forecast.points.forEach((p) => expect(p.high).toBeLessThanOrEqual(100));
  });
});

/** A seeded series: level, slope, weekly rhythm and noise, held inside the valid range. */
function randomCase(i: number): { metric: MetricKey; series: SeriesPoint[]; horizon: number } {
  const rng = new SeededRandom(seedFor('forecast-property', START, `case:${i}`));
  const metric = rng.pick(METRICS);
  const [min, max] = RANGE[metric];
  const span = metric === 'available' ? 150 : (max - min);
  const level = rng.float(0, span);
  const slope = rng.float(-0.004, 0.004) * span;
  const rhythm = Array.from({ length: 7 }, () => rng.float(-0.05, 0.05) * span);
  const n = rng.int(28, 120);
  const start = dateAt(rng.int(0, 400));
  const series = Array.from({ length: n }, (_, t) => {
    const raw = level + slope * t + (rhythm[t % 7] as number) + rng.float(-0.04, 0.04) * span;
    const clipped = Math.min(max, Math.max(min, raw));
    const value = metric === 'available' ? Math.round(clipped) : Number(clipped.toFixed(4));
    return { date: dateAt(t, start), value };
  });
  return { metric, series, horizon: rng.int(1, 28) };
}

function shuffled<T>(items: readonly T[], seed: string): T[] {
  const rng = new SeededRandom(seed);
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = rng.int(0, i);
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

describe('forecast properties over seeded series', () => {
  const cases = Array.from({ length: 60 }, (_, i) => randomCase(i));

  it.each(cases.map((c, i) => [i, c] as const))('case %s', (i, { metric, series, horizon }) => {
    const before = structuredClone(series);
    const frozen = Object.freeze(series.map((p) => Object.freeze({ ...p })));
    const forecast = okOf(forecastSeries(frozen, metric, horizon));
    const [min, max] = RANGE[metric];
    const last = series.at(-1) as SeriesPoint;

    expect(forecast.points).toHaveLength(horizon);
    expect(forecast.horizonDays).toBe(horizon);
    forecast.points.forEach((p, h) => {
      expect(p.date).toBe(dateAt(h + 1, last.date));
      [p.value, p.low, p.high].forEach((v) => {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(min);
        expect(v).toBeLessThanOrEqual(max);
        if (metric === 'available') expect(Number.isInteger(v)).toBe(true);
      });
      expect(p.low).toBeLessThanOrEqual(p.value);
      expect(p.value).toBeLessThanOrEqual(p.high);
    });
    expect(Number.isFinite(forecast.backtestMae)).toBe(true);
    expect(series).toEqual(before);
    expect(forecastSeries(series, metric, horizon)).toEqual({ status: 'ok', forecast });
    const mixed = shuffled(series, `shuffle:${i}`);
    expect(forecastSeries(mixed, metric, horizon)).toEqual({ status: 'ok', forecast });
  });
});
