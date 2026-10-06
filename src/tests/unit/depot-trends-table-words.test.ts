import { describe, expect, it } from 'vitest';
import type { TrendRow } from '@/lib/depot/forecast/api';
import { metricInfo } from '@/lib/depot/forecast/wording';
import { trendTableRows } from '@/lib/depot/forecast/trendsTableModel';

function unit(id: string, week: number, fourWeeks: number | null, direction: 'up' | 'down' | 'steady'): TrendRow {
  return {
    id,
    name: `Depot ${id}`,
    endDate: '2026-10-06',
    values: [0.8, 0.81, 0.82],
    trend: { direction, week, fourWeeks, sentence: 'MODELLED trend: steady over 4 weeks' },
  };
}

const ON_ROAD = { metric: metricInfo('onRoadShare'), trendUnit: 'percentage_points' as const };
const NONE: TrendRow = { id: '4', name: 'Depot 4', endDate: '', values: [], trend: null };

describe('trend table rows: one signed number and a direction word per change', () => {
  const rows = trendTableRows({
    ...ON_ROAD,
    units: [
      unit('1', 0.4, 2.1, 'up'),
      unit('2', -1.2, -3, 'down'),
      unit('3', 1, null, 'steady'),
      NONE,
    ],
  });

  it('prints each change as a bare signed number', () => {
    expect(rows.map((r) => [r.weekSigned, r.fourWeeksSigned])).toEqual([
      ['+0.4', '+2.1'],
      ['−1.2', '−3.0'],
      ['+1.0', '—'],
      ['—', '—'],
    ]);
  });

  it('puts the four-week direction in its own word, and says when history is too short', () => {
    expect(rows.map((r) => r.fourWeeksWord)).toEqual(['UP', 'DOWN', 'TOO SHORT', '—']);
  });

  it('gives the week a word only when the dead-band rule recomputed on the row agrees', () => {
    // A 3-value series is too short to recompute the week, so no word is printed.
    expect(rows.map((r) => r.weekWord)).toEqual(['—', '—', '—', '—']);
  });

  it('gives the week a word from the same dead-band rule when the series is long enough', () => {
    const values = Array.from({ length: 40 }, (_, i) => 0.8 + (i % 7) * 0.001);
    const flat: TrendRow = { ...unit('5', 0, 0, 'steady'), values };
    const [row] = trendTableRows({ ...ON_ROAD, units: [flat] });
    expect(row?.weekWord).toBe('STEADY');
  });

  it('keeps a steady four weeks as STEADY beside its signed number', () => {
    const [row] = trendTableRows({ ...ON_ROAD, units: [unit('9', 0, -0.1, 'steady')] });
    expect([row?.fourWeeksSigned, row?.fourWeeksWord]).toEqual(['−0.1', 'STEADY']);
  });
});
