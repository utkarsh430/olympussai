import { describe, expect, it } from 'vitest';
import {
  TREND_COLUMN_WIDTHS,
  TREND_MIN_SPARE_PX,
  trendColumnKeys,
  trendSparkWidth,
  trendUnitTitle,
} from '@/lib/depot/forecast/trendsTableLayout';
import type { TrendSortKey, TrendTableRow } from '@/lib/depot/forecast/trendsTableModel';
import { TABLE_FRAME_BORDER_PX, contentWidthAt } from '@/lib/depot/shell/geometry';
import { TIER_FRAME_PX, type TableTier } from '@/lib/depot/shell/tableTier';
import { tableWidth } from '@/lib/depot/shell/tableWidth';

/** The laid-out width: the shown columns plus the frame border. */
const trendTableWidth = (tier: TableTier, sort: TrendSortKey): number =>
  tableWidth(TREND_COLUMN_WIDTHS[tier], trendColumnKeys(tier, sort)) + TABLE_FRAME_BORDER_PX;

const SORTS: readonly TrendSortKey[] = ['name', 'week', 'fourWeeks'];

describe('network trends unit table per width (critique §7)', () => {
  it('shows every column from 1280, and the critique sets at 1024 and 800', () => {
    expect(trendColumnKeys('wide', 'fourWeeks')).toEqual([
      'name',
      'spark',
      'week',
      'weekWord',
      'fourWeeks',
      'fourWeeksWord',
    ]);
    expect(trendColumnKeys('medium', 'fourWeeks')).toEqual([
      'name',
      'spark',
      'week',
      'fourWeeks',
      'fourWeeksWord',
    ]);
    expect(trendColumnKeys('narrow', 'fourWeeks')).toEqual([
      'name',
      'spark',
      'fourWeeks',
      'fourWeeksWord',
    ]);
    expect(TREND_COLUMN_WIDTHS.medium.spark).toBe(80);
    expect(trendSparkWidth('medium')).toBeLessThanOrEqual(80 - 24);
  });

  it('never drops the sorted column: the 7 days pair takes the four weeks pair place at 800', () => {
    for (const tier of ['wide', 'medium', 'narrow'] as const) {
      for (const sort of SORTS) expect(trendColumnKeys(tier, sort)).toContain(sort);
    }
    expect(trendColumnKeys('narrow', 'week')).toEqual(['name', 'spark', 'week', 'weekWord']);
  });

  it.each<[TableTier, TrendSortKey, number]>([
    ['wide', 'fourWeeks', 962],
    ['medium', 'fourWeeks', 752],
    ['medium', 'week', 752],
    ['narrow', 'fourWeeks', 592],
    ['narrow', 'week', 582],
    ['narrow', 'name', 592],
  ])('fits the %s frame sorted by %s at %i px with 8 px to spare', (tier, sort, sum) => {
    expect(trendTableWidth(tier, sort)).toBe(sum);
    expect(trendTableWidth(tier, sort)).toBeLessThanOrEqual(TIER_FRAME_PX[tier] - TREND_MIN_SPARE_PX);
    expect(TREND_MIN_SPARE_PX).toBe(8);
  });

  it('pins the frames: 976 at 1024 and 752 at 800', () => {
    expect(TIER_FRAME_PX.medium).toBe(contentWidthAt(1024));
    expect(TIER_FRAME_PX.narrow).toBe(contentWidthAt(800));
  });

  it('puts what a width drops in the unit cell title', () => {
    const row = {
      name: 'Alambagh',
      weekSigned: '+1.0',
      weekWord: 'UP',
      fourWeeksSigned: '−2.0',
      fourWeeksWord: 'DOWN',
    } as TrendTableRow;
    const headers = {
      week: 'Over 7 days',
      weekWord: 'Trend, 7 days',
      fourWeeks: 'Over 4 weeks',
      fourWeeksWord: 'Trend, 4 weeks',
      unit: 'pp',
    };
    expect(trendUnitTitle(row, trendColumnKeys('wide', 'fourWeeks'), headers)).toBe('Alambagh');
    expect(trendUnitTitle(row, trendColumnKeys('medium', 'fourWeeks'), headers)).toBe(
      'Alambagh; Trend, 7 days: UP',
    );
    expect(trendUnitTitle(row, trendColumnKeys('narrow', 'fourWeeks'), headers)).toBe(
      'Alambagh; Over 7 days: +1.0 pp; Trend, 7 days: UP',
    );
  });
});
