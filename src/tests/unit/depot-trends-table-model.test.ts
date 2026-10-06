import { describe, expect, it } from 'vitest';
import type { TrendRow } from '@/lib/depot/forecast/api';
import { metricInfo } from '@/lib/depot/forecast/wording';
import {
  capTrendRows,
  defaultTrendSort,
  sortTrendRows,
  TREND_ROW_CAP,
  trendColumnHeaders,
  trendTableCaption,
  trendTableRows,
} from '@/lib/depot/forecast/trendsTableModel';

function unit(id: string, week: number, fourWeeks: number | null, sentence: string): TrendRow {
  return {
    id,
    name: `Depot ${id}`,
    endDate: '2026-10-06',
    values: [0.8, 0.81, 0.82],
    trend: {
      direction: sentence.includes(' up ') ? 'up' : sentence.includes(' down ') ? 'down' : 'steady',
      week,
      fourWeeks,
      sentence,
    },
  };
}

const ON_ROAD = { metric: metricInfo('onRoadShare'), trendUnit: 'percentage_points' as const };
const UP = unit('1', 0.4, 2.1, 'MODELLED trend: up 2.1 percentage points over 4 weeks');
const DOWN = unit('2', -1.2, -3, 'MODELLED trend: down 3.0 percentage points over 4 weeks');
const SHORT = unit('3', 1, null, 'MODELLED trend: steady over 7 days');
const NONE: TrendRow = { id: '4', name: 'Depot 4', endDate: '', values: [], trend: null };

describe('trend table rows', () => {
  const rows = trendTableRows({ ...ON_ROAD, units: [UP, DOWN, SHORT, NONE] });

  it('links each unit to its own trends page for the same metric', () => {
    expect(rows.map((r) => r.href)).toEqual([
      '/project/depots/d/1/trends?metric=onRoadShare',
      '/project/depots/d/2/trends?metric=onRoadShare',
      '/project/depots/d/3/trends?metric=onRoadShare',
      '/project/depots/d/4/trends?metric=onRoadShare',
    ]);
  });

  it('prints the week as a signed change and four weeks as a direction word and change', () => {
    expect(rows.map((r) => [r.weekText, r.fourWeeksText])).toEqual([
      ['+0.4', 'up 2.1'],
      ['−1.2', 'down 3.0'],
      ['+1.0', 'too little history'],
      ['—', '—'],
    ]);
  });

  it('prints counts as whole buses and a steady four weeks with its change', () => {
    const bus = unit('9', 0, -1, 'MODELLED trend: steady over 4 weeks');
    const [row] = trendTableRows({
      metric: metricInfo('available'),
      trendUnit: 'buses',
      units: [bus],
    });
    expect([row?.weekText, row?.fourWeeksText]).toEqual(['0', 'steady, −1']);
  });

  it('gives every sparkline a text equivalent that carries MODELLED', () => {
    expect(rows[0]?.sparkLabel).toBe(
      'On-road share at Depot 1, MODELLED trend: up 2.1 percentage points over 4 weeks, ending on the live value',
    );
    expect(rows[3]?.sparkLabel).toBe('On-road share at Depot 4: no MODELLED trend yet');
  });

  it('names the unit in each column header, with no tag on the page default', () => {
    // Rewritten: the unit moved into its own header field (the table prints it after the
    // header, bare signed numbers in the cells) and the direction word got its own column.
    expect(trendColumnHeaders(ON_ROAD.trendUnit, 30)).toEqual({
      spark: 'Last 30 days',
      week: 'Over 7 days',
      weekWord: 'Trend, 7 days',
      fourWeeks: 'Over 4 weeks',
      fourWeeksWord: 'Trend, 4 weeks',
      unit: 'pp',
    });
  });
});

describe('sorting and capping', () => {
  const rows = trendTableRows({ ...ON_ROAD, units: [UP, NONE, DOWN, SHORT] });

  it('starts with the worst four-week change first, by whether higher is better', () => {
    expect(defaultTrendSort(true)).toEqual({ key: 'fourWeeks', direction: 'asc' });
    expect(defaultTrendSort(false)).toEqual({ key: 'fourWeeks', direction: 'desc' });
  });

  it('sorts by a change either way and always puts rows without one last', () => {
    const ids = (sort: Parameters<typeof sortTrendRows>[1]): string[] =>
      sortTrendRows(rows, sort).map((r) => r.id);
    expect(ids({ key: 'fourWeeks', direction: 'asc' })).toEqual(['2', '1', '3', '4']);
    expect(ids({ key: 'fourWeeks', direction: 'desc' })).toEqual(['1', '2', '3', '4']);
    expect(ids({ key: 'week', direction: 'desc' })).toEqual(['3', '1', '2', '4']);
    expect(ids({ key: 'name', direction: 'desc' })).toEqual(['4', '3', '2', '1']);
  });

  it('breaks ties by name so the order never depends on the feed order', () => {
    const a = unit('b', 1, 1, 'MODELLED trend: steady over 4 weeks');
    const b = unit('a', 1, 1, 'MODELLED trend: steady over 4 weeks');
    const tied = trendTableRows({ ...ON_ROAD, units: [a, b] });
    expect(sortTrendRows(tied, { key: 'fourWeeks', direction: 'desc' }).map((r) => r.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('does not reorder the rows it was given', () => {
    const before = rows.map((r) => r.id);
    sortTrendRows(rows, { key: 'fourWeeks', direction: 'asc' });
    expect(rows.map((r) => r.id)).toEqual(before);
  });

  it('shows the first rows until asked for all', () => {
    const many = Array.from({ length: TREND_ROW_CAP + 5 }, (_, i) => i);
    expect(capTrendRows(many, false)).toEqual({ shown: many.slice(0, TREND_ROW_CAP), hidden: 5 });
    expect(capTrendRows(many, true)).toEqual({ shown: many, hidden: 0 });
    expect(capTrendRows([1, 2], false)).toEqual({ shown: [1, 2], hidden: 0 });
  });

  it('captions the table with the metric, the count shown and the order, with no tag', () => {
    expect(
      trendTableCaption('On-road share', 113, 25, { key: 'fourWeeks', direction: 'asc' }),
    ).toBe(
      'Trends of on-road share: 25 of 113 units, by change over 4 weeks, lowest first',
    );
    expect(trendTableCaption('Dark rate', 3, 3, { key: 'name', direction: 'asc' })).toBe(
      'Trends of dark rate: all 3 units, by name, A to Z',
    );
  });
});
