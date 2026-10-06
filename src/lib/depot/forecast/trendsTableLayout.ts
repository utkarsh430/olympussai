import { TIER_FRAME_PX, type TableTier } from '../revenue/tableTier';
import type { TrendSortKey, TrendTableRow } from './trendsTableModel';

/*
 * The network trends unit table per width (critique round 5, section 7). Every column
 * from 1280; at 1024 the sparkline narrows to 80 px and "Trend, 7 days" goes to the
 * unit cell's title; at 800 the table keeps UNIT · 30 DAYS · 4 WEEKS PP · TREND. The
 * column the table is sorted by is never dropped: sorted by the 7 days' change at 800,
 * that change and its word take the places of the four weeks' pair.
 */

export type TrendColumnKey = 'name' | 'spark' | 'week' | 'weekWord' | 'fourWeeks' | 'fourWeeksWord';

const WIDE_WIDTHS: Readonly<Record<TrendColumnKey, number>> = {
  name: 200,
  spark: 150,
  week: 160,
  weekWord: 140,
  fourWeeks: 160,
  fourWeeksWord: 150,
};

/** The sparkline column is 80 px wide below 1280; a cell's padding is 12 px each side. */
const NARROW_SPARK_PX = 80;
const CELL_PADDING_PX = 24;
const SPARKLINE_PX = 96;

/** Each column's width per tier, in px. */
export const TREND_COLUMN_WIDTHS: Readonly<
  Record<TableTier, Readonly<Record<TrendColumnKey, number>>>
> = {
  wide: WIDE_WIDTHS,
  medium: { ...WIDE_WIDTHS, spark: NARROW_SPARK_PX },
  narrow: { ...WIDE_WIDTHS, spark: NARROW_SPARK_PX },
};

/** The sparkline's drawn width in its column, per tier. */
export function trendSparkWidth(tier: TableTier): number {
  return tier === 'wide' ? SPARKLINE_PX : NARROW_SPARK_PX - CELL_PADDING_PX;
}

/** The table frame's border, 1 px each side. */
export const TREND_FRAME_BORDER_PX = 2;

/** Every column set leaves at least this much of its frame unused. */
export const TREND_MIN_SPARE_PX = 8;

const SETS: Readonly<Record<TableTier, readonly TrendColumnKey[]>> = {
  wide: ['name', 'spark', 'week', 'weekWord', 'fourWeeks', 'fourWeeksWord'],
  medium: ['name', 'spark', 'week', 'fourWeeks', 'fourWeeksWord'],
  narrow: ['name', 'spark', 'fourWeeks', 'fourWeeksWord'],
};

/** The 7 days' pair stands in for the four weeks' pair, and the other way round. */
const SIBLING: Readonly<Partial<Record<TrendColumnKey, TrendColumnKey>>> = {
  week: 'fourWeeks',
  weekWord: 'fourWeeksWord',
  fourWeeks: 'week',
  fourWeeksWord: 'weekWord',
};

/** The columns shown at a tier; the sorted column (and its word) always among them. */
export function trendColumnKeys(tier: TableTier, sortKey: TrendSortKey): readonly TrendColumnKey[] {
  const base = SETS[tier];
  if (base.includes(sortKey)) return base;
  const word: TrendColumnKey = sortKey === 'week' ? 'weekWord' : 'fourWeeksWord';
  const swaps = new Map<TrendColumnKey, TrendColumnKey>([
    [SIBLING[sortKey] as TrendColumnKey, sortKey],
    [SIBLING[word] as TrendColumnKey, word],
  ]);
  return base.map((key) => swaps.get(key) ?? key);
}

/** The laid-out width: the shown columns plus the frame border. Throws on a missing width. */
export function trendTableWidth(tier: TableTier, sortKey: TrendSortKey): number {
  const widths = TREND_COLUMN_WIDTHS[tier];
  const columns = trendColumnKeys(tier, sortKey).reduce((sum, key) => {
    const width = widths[key];
    if (width === undefined) throw new Error(`trend column ${key} has no width`);
    return sum + width;
  }, 0);
  return columns + TREND_FRAME_BORDER_PX;
}

/** The frame a tier's table must fit, less the spare. */
export function trendFrameBudget(tier: TableTier): number {
  return TIER_FRAME_PX[tier] - TREND_MIN_SPARE_PX;
}

/**
 * The unit cell's title: the unit's name, then each change or word whose column this
 * width drops, so nothing is lost ("Alambagh; Trend, 7 days: UP").
 */
export function trendUnitTitle(
  row: TrendTableRow,
  shown: readonly TrendColumnKey[],
  headers: {
    readonly week: string;
    readonly weekWord: string;
    readonly fourWeeks: string;
    readonly fourWeeksWord: string;
    readonly unit: string;
  },
): string {
  const dropped: readonly [TrendColumnKey, string][] = [
    ['week', `${headers.week}: ${row.weekSigned} ${headers.unit}`],
    ['weekWord', `${headers.weekWord}: ${row.weekWord}`],
    ['fourWeeks', `${headers.fourWeeks}: ${row.fourWeeksSigned} ${headers.unit}`],
    ['fourWeeksWord', `${headers.fourWeeksWord}: ${row.fourWeeksWord}`],
  ];
  const extra = dropped.filter(([key]) => !shown.includes(key)).map(([, text]) => text);
  return [row.name, ...extra].join('; ');
}
