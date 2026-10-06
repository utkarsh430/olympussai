import { describe, expect, it } from 'vitest';
import type { TrendRow } from '@/lib/depot/forecast/api';
import { addDays } from '@/lib/depot/forecast/series';
import { summariseTrend } from '@/lib/depot/forecast/trend';
import { trendTableRows, weekDirection } from '@/lib/depot/forecast/trendsTableModel';
import { metricInfo } from '@/lib/depot/forecast/wording';

const END = '2026-10-06';
const DAYS = 30;

/** A rate series that rises by `step` a day (0 = flat), ending on END. */
function series(step: number): number[] {
  return Array.from({ length: DAYS }, (_, i) => 0.7 + step * i);
}

function rowOf(values: number[]): TrendRow {
  const points = values.map((value, i) => ({ date: addDays(END, i - (values.length - 1)), value }));
  const result = summariseTrend(points, 'onRoadShare');
  if (result.status !== 'ok') throw new Error('fixture must have a trend');
  const { week, fourWeeks, sentence, } = result.summary;
  return {
    id: '1',
    name: 'Depot 1',
    endDate: END,
    values,
    trend: { direction: (fourWeeks ?? week).direction, week: week.change, fourWeeks: fourWeeks?.change ?? null, sentence },
  };
}

describe('the one-week direction word', () => {
  it('is the same dead-band word the trend function gives the week', () => {
    for (const step of [0, 0.004, -0.004]) {
      const row = rowOf(series(step));
      const result = summariseTrend(
        row.values.map((value, i) => ({ date: addDays(END, i - (row.values.length - 1)), value })),
        'onRoadShare',
      );
      expect(result.status === 'ok' && weekDirection(row, 'onRoadShare')).toBe(
        result.status === 'ok' ? result.summary.week.direction : null,
      );
    }
  });

  it('prints a word and the signed change in the week column', () => {
    const response = { metric: metricInfo('onRoadShare'), trendUnit: 'percentage_points' as const, units: [rowOf(series(0.004))] };
    const text = trendTableRows(response)[0]?.weekText ?? '';
    expect(text).toMatch(/^(up \d+\.\d|steady, [+−]?\d+\.\d)/);
  });

  it('prints no word when the batch figure and the recomputation disagree', () => {
    const row = rowOf(series(0.004));
    const forged: TrendRow = { ...row, trend: row.trend === null ? null : { ...row.trend, week: row.trend.week + 5 } };
    expect(weekDirection(forged, 'onRoadShare')).toBeNull();
  });

  it('has none for a unit without a trend', () => {
    expect(weekDirection({ id: '1', name: 'x', endDate: '', values: [], trend: null }, 'onRoadShare')).toBeNull();
  });
});
