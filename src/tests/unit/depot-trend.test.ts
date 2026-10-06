import { describe, expect, it } from 'vitest';
import { summariseTrend, type TrendResult, type TrendSummary } from '@/lib/depot/forecast/trend';
import type { MetricKey, SeriesPoint } from '@/lib/depot/sim/types';

const DAY = 86_400_000;
const START = '2026-03-01';

function dateAt(i: number): string {
  return new Date(Date.parse(`${START}T00:00:00Z`) + i * DAY).toISOString().slice(0, 10);
}

/** `n` days ending on day n-1; the value 30, 7 and 0 days back is set explicitly. */
function seriesWith(
  n: number,
  fill: number,
  ends: { readonly month?: number; readonly week?: number; readonly latest: number },
): SeriesPoint[] {
  return Array.from({ length: n }, (_, i) => {
    const back = n - 1 - i;
    const value =
      back === 0 ? ends.latest : back === 7 ? ends.week : back === 30 ? ends.month : undefined;
    return { date: dateAt(i), value: value ?? fill };
  });
}

function okOf(result: TrendResult): TrendSummary {
  if (result.status !== 'ok') throw new Error(`expected a trend, got ${result.status}`);
  return result.summary;
}

describe('summariseTrend', () => {
  it('reports a rate change in percentage points over 7 and 30 days', () => {
    const series = seriesWith(40, 0.8, { month: 0.81, week: 0.845, latest: 0.831 });
    const summary = okOf(summariseTrend(series, 'onRoadShare'));
    expect(summary.kind).toBe('rate');
    expect(summary.unit).toBe('percentage_points');
    expect(summary.latest).toEqual({ date: dateAt(39), value: 0.831 });
    expect(summary.month).toMatchObject({
      days: 30,
      from: { date: dateAt(9), value: 0.81 },
      change: 2.1,
      direction: 'up',
      sentence: 'up 2.1 percentage points over 30 days',
    });
    expect(summary.week).toMatchObject({
      days: 7,
      from: { date: dateAt(32), value: 0.845 },
      change: -1.4,
      direction: 'down',
      sentence: 'down 1.4 percentage points over 7 days',
    });
    expect(summary.sentence).toBe('up 2.1 percentage points over 30 days');
  });

  it('reports the index in points and a count in buses', () => {
    const index = okOf(summariseTrend(seriesWith(31, 60, { month: 64.5, latest: 62.4 }), 'index'));
    expect([index.unit, index.sentence]).toEqual(['points', 'down 2.1 points over 30 days']);
    const count = okOf(
      summariseTrend(seriesWith(31, 100, { month: 96, week: 103, latest: 101 }), 'available'),
    );
    expect(count.unit).toBe('buses');
    expect(count.month?.sentence).toBe('up 5 buses over 30 days');
    expect(count.week.sentence).toBe('down 2 buses over 7 days');
  });

  it.each([
    ['onRoadShare', 0.8, 0.804, 'steady', 'steady over 30 days'],
    ['onRoadShare', 0.8, 0.805, 'up', 'up 0.5 percentage points over 30 days'],
    ['darkRate', 0.03, 0.0249, 'down', 'down 0.5 percentage points over 30 days'],
    ['index', 70, 70.9, 'steady', 'steady over 30 days'],
    ['index', 70, 71, 'up', 'up 1.0 points over 30 days'],
    ['available', 120, 119, 'steady', 'steady over 30 days'],
    ['available', 120, 118, 'down', 'down 2 buses over 30 days'],
  ] as const)('reads %s from %s to %s as %s', (metric, from, latest, direction, sentence) => {
    const summary = okOf(summariseTrend(seriesWith(31, from, { month: from, latest }), metric));
    expect(summary.month?.direction).toBe(direction);
    expect(summary.month?.sentence).toBe(sentence);
  });

  it.each([
    ['onRoadShare', true],
    ['offRoadRate', false],
    ['darkRate', false],
    ['index', true],
    ['available', true],
  ] as const)('knows whether higher is better for %s', (metric: MetricKey, better) => {
    const value = metric === 'index' ? 50 : metric === 'available' ? 10 : 0.5;
    const summary = okOf(summariseTrend(seriesWith(8, value, { latest: value }), metric));
    expect(summary.higherIsBetter).toBe(better);
  });

  it('falls back to the week when the history is shorter than 31 days', () => {
    const summary = okOf(summariseTrend(seriesWith(30, 50, { week: 47, latest: 50 }), 'index'));
    expect(summary.month).toBeNull();
    expect(summary.historyDays).toBe(30);
    expect(summary.sentence).toBe('up 3.0 points over 7 days');
  });

  it('needs eight contiguous days, and a missing day ends the run', () => {
    expect(summariseTrend(seriesWith(7, 50, { latest: 50 }), 'index')).toEqual({
      status: 'insufficient_history',
      historyDays: 7,
      required: 8,
      cause: 'short_record',
      missingDate: null,
    });
    const gapped = seriesWith(40, 50, { latest: 50 }).filter((_, i) => i !== 36);
    expect(summariseTrend(gapped, 'index')).toEqual({
      status: 'insufficient_history',
      historyDays: 3,
      required: 8,
      cause: 'gap',
      missingDate: dateAt(36),
    });
    const oldGap = seriesWith(40, 50, { month: 40, latest: 50 }).filter((_, i) => i !== 5);
    const summary = okOf(summariseTrend(oldGap, 'index'));
    expect(summary.historyDays).toBe(34);
    expect(summary.month?.change).toBe(10);
  });

  it('refuses bad input with a typed result', () => {
    const series = seriesWith(10, 50, { latest: 50 });
    const nan = [...series.slice(0, 9), { date: dateAt(9), value: Number.NaN }];
    expect(summariseTrend(nan, 'index')).toEqual({ status: 'invalid_input', reason: 'non_finite_value' });
    const tooHigh = [...series.slice(0, 9), { date: dateAt(9), value: 1.2 }];
    expect(summariseTrend(tooHigh, 'darkRate')).toEqual({ status: 'invalid_input', reason: 'out_of_range' });
    const dup = [...series, { date: dateAt(2), value: 50 }];
    expect(summariseTrend(dup, 'index')).toEqual({ status: 'invalid_input', reason: 'duplicate_date' });
  });

  it('is pure: order-independent, repeatable and leaves its input alone', () => {
    const series = Object.freeze(
      seriesWith(40, 0.1, { month: 0.12, week: 0.09, latest: 0.1 }).map((p) => Object.freeze(p)),
    );
    const first = summariseTrend(series, 'offRoadRate');
    expect(summariseTrend([...series].reverse(), 'offRoadRate')).toEqual(first);
    expect(summariseTrend(series, 'offRoadRate')).toEqual(first);
    expect(okOf(first).month?.sentence).toBe('down 2.0 percentage points over 30 days');
  });
});
