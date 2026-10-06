import { STEADY_BAND } from '@/lib/depot/forecast/config';
import { describe, expect, it } from 'vitest';
import { summariseTrend, type TrendResult, type TrendSummary } from '@/lib/depot/forecast/trend';
import type { MetricKey, SeriesPoint } from '@/lib/depot/sim/types';

const DAY = 86_400_000;
const START = '2026-03-01';

function dateAt(i: number): string {
  return new Date(Date.parse(`${START}T00:00:00Z`) + i * DAY).toISOString().slice(0, 10);
}

/** `n` days ending on day n-1; the value 28, 7 and 0 days back is set explicitly. */
function seriesWith(
  n: number,
  fill: number,
  ends: { readonly fourWeeks?: number; readonly week?: number; readonly latest: number },
): SeriesPoint[] {
  return Array.from({ length: n }, (_, i) => {
    const back = n - 1 - i;
    const value =
      back === 0 ? ends.latest : back === 7 ? ends.week : back === 28 ? ends.fourWeeks : undefined;
    return { date: dateAt(i), value: value ?? fill };
  });
}

function okOf(result: TrendResult): TrendSummary {
  if (result.status !== 'ok') throw new Error(`expected a trend, got ${result.status}`);
  return result.summary;
}

describe('summariseTrend', () => {
  it('reports a rate change in percentage points over 7 days and 4 weeks', () => {
    const series = seriesWith(40, 0.8, { fourWeeks: 0.81, week: 0.845, latest: 0.831 });
    const summary = okOf(summariseTrend(series, 'onRoadShare'));
    expect(summary.kind).toBe('rate');
    expect(summary.unit).toBe('percentage_points');
    expect(summary.latest).toEqual({ date: dateAt(39), value: 0.831 });
    expect(summary.fourWeeks).toMatchObject({
      days: 28,
      from: { date: dateAt(11), value: 0.81 },
      change: 2.1,
      direction: 'up',
      sentence: 'up 2.1 percentage points over 4 weeks',
    });
    expect(summary.week).toMatchObject({
      days: 7,
      from: { date: dateAt(32), value: 0.845 },
      change: -1.4,
      direction: 'down',
      sentence: 'down 1.4 percentage points over 7 days',
    });
    expect(summary.sentence).toBe('up 2.1 percentage points over 4 weeks');
  });

  it('reports the index in points and a count in buses', () => {
    const index = okOf(
      summariseTrend(seriesWith(29, 60, { fourWeeks: 64.5, latest: 62.4 }), 'index'),
    );
    expect([index.unit, index.sentence]).toEqual(['points', 'down 2.1 points over 4 weeks']);
    const count = okOf(
      summariseTrend(seriesWith(29, 100, { fourWeeks: 96, week: 103, latest: 101 }), 'available'),
    );
    expect(count.unit).toBe('buses');
    expect(count.fourWeeks?.sentence).toBe('up 5 buses over 4 weeks');
    expect(count.week.sentence).toBe('down 2 buses over 7 days');
  });

  it.each([
    ['onRoadShare', 0.8, 0.804, 'steady', 'steady over 4 weeks'],
    ['onRoadShare', 0.8, 0.805, 'up', 'up 0.5 percentage points over 4 weeks'],
    ['darkRate', 0.03, 0.0249, 'down', 'down 0.5 percentage points over 4 weeks'],
    ['index', 70, 70.9, 'steady', 'steady over 4 weeks'],
    ['index', 70, 71, 'up', 'up 1.0 points over 4 weeks'],
    ['available', 120, 119, 'steady', 'steady over 4 weeks'],
    ['available', 120, 118, 'down', 'down 2 buses over 4 weeks'],
  ] as const)('reads %s from %s to %s as %s', (metric, from, latest, direction, sentence) => {
    const summary = okOf(summariseTrend(seriesWith(29, from, { fourWeeks: from, latest }), metric));
    expect(summary.fourWeeks?.direction).toBe(direction);
    expect(summary.fourWeeks?.sentence).toBe(sentence);
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

  it('falls back to the week when the history is shorter than 29 days', () => {
    const summary = okOf(summariseTrend(seriesWith(28, 50, { week: 47, latest: 50 }), 'index'));
    expect(summary.fourWeeks).toBeNull();
    expect(summary.historyDays).toBe(28);
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
    const oldGap = seriesWith(40, 50, { fourWeeks: 40, latest: 50 }).filter((_, i) => i !== 5);
    const summary = okOf(summariseTrend(oldGap, 'index'));
    expect(summary.historyDays).toBe(34);
    expect(summary.fourWeeks?.change).toBe(10);
  });

  it('refuses bad input with a typed result', () => {
    const series = seriesWith(10, 50, { latest: 50 });
    const nan = [...series.slice(0, 9), { date: dateAt(9), value: Number.NaN }];
    expect(summariseTrend(nan, 'index')).toEqual({
      status: 'invalid_input',
      reason: 'non_finite_value',
    });
    const tooHigh = [...series.slice(0, 9), { date: dateAt(9), value: 1.2 }];
    expect(summariseTrend(tooHigh, 'darkRate')).toEqual({
      status: 'invalid_input',
      reason: 'out_of_range',
    });
    const dup = [...series, { date: dateAt(2), value: 50 }];
    expect(summariseTrend(dup, 'index')).toEqual({
      status: 'invalid_input',
      reason: 'duplicate_date',
    });
  });

  it('is pure: order-independent, repeatable and leaves its input alone', () => {
    const series = Object.freeze(
      seriesWith(40, 0.1, { fourWeeks: 0.12, week: 0.09, latest: 0.1 }).map((p) =>
        Object.freeze(p),
      ),
    );
    const first = summariseTrend(series, 'offRoadRate');
    expect(summariseTrend([...series].reverse(), 'offRoadRate')).toEqual(first);
    expect(summariseTrend(series, 'offRoadRate')).toEqual(first);
    expect(okOf(first).fourWeeks?.sentence).toBe('down 2.0 percentage points over 4 weeks');
  });

  it('reads a change as steady while it is inside the series own variation at that lag', () => {
    // A weekly-free zigzag: every 7-day and 28-day change is +-3 or 0 points.
    const values = Array.from(
      { length: 121 },
      (_, i) => 60 + (i % 3 === 0 ? 0 : i % 3 === 1 ? 3 : -3),
    );
    const series = values.map((value, i) => ({ date: dateAt(i), value }));
    const summary = okOf(summariseTrend(series, 'index'));
    expect(summary.week.steadyWithin).toBe(6);
    expect(summary.fourWeeks?.steadyWithin).toBe(6);
    expect(summary.week.direction).toBe('steady');
    // A real move of more than the variation reads as one.
    const moved = [...series.slice(0, -1), { date: dateAt(120), value: 70 }];
    expect(okOf(summariseTrend(moved, 'index')).fourWeeks?.sentence).toBe(
      'up 13.0 points over 4 weeks',
    );
  });

  it('keeps the per-kind band as a floor, and uses only it with fewer than two weeks of changes', () => {
    const flat = okOf(summariseTrend(seriesWith(60, 50, { latest: 50.9 }), 'index'));
    expect(flat.fourWeeks?.steadyWithin).toBe(STEADY_BAND.index);
    const short = Array.from({ length: 35 }, (_, i) => ({
      date: dateAt(i),
      value: 50 + (i % 2) * 9,
    }));
    expect(okOf(summariseTrend(short, 'index')).fourWeeks?.steadyWithin).toBe(STEADY_BAND.index);
    expect(okOf(summariseTrend(short, 'index')).week.steadyWithin).toBe(9);
  });

  it('rounds a halfway change the same way after stripping binary noise', () => {
    // 0.8305 - 0.81 is 2.0499999999999963 pp in binary; it is 2.05 and rounds up.
    const rate = okOf(
      summariseTrend(seriesWith(29, 0.81, { fourWeeks: 0.81, latest: 0.8305 }), 'onRoadShare'),
    );
    expect(rate.fourWeeks?.sentence).toBe('up 2.1 percentage points over 4 weeks');
    const index = okOf(
      summariseTrend(seriesWith(29, 50, { fourWeeks: 50, latest: 51.15 }), 'index'),
    );
    expect(index.fourWeeks?.change).toBe(1.2);
  });

  it('takes the nearest-rank 80th percentile of the changes at the lag, by a plain count', () => {
    const values = Array.from({ length: 50 }, (_, i) => 50 + ((i * 7919) % 23) / 3);
    const series = values.map((value, i) => ({ date: dateAt(i), value }));
    const changes: number[] = [];
    for (let t = 7; t < values.length; t += 1) {
      changes.push(Math.abs((values[t] as number) - (values[t - 7] as number)));
    }
    const sorted = [...changes].sort((a, b) => a - b);
    const at = (q: number): number => sorted[Math.ceil(q * sorted.length) - 1] as number;
    expect(at(0.8)).not.toBe(at(0.9));
    expect(okOf(summariseTrend(series, 'index')).week.steadyWithin).toBe(Math.max(1, at(0.8)));
  });
});
