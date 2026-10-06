import type { DeiComponentKey } from '@/lib/depot/score/types';

/*
 * The league's frozen block (Rank, Depot, Index) decided in one place. A table cell's
 * width is only a hint to the browser: a header wider than its column (Rank with its
 * sort arrow) widened the column, the next frozen cell still stuck at the hinted offset,
 * and Rank's right-aligned digits slid under Depot. So every frozen cell gets the same
 * width, min and max, its content is boxed to the inner width below (padding and
 * borders taken off), and each `left` is the sum of the widths before it. Two sizes:
 * compact under 640px, so the block fits a phone's frame, and wide from 640px. Depot is
 * wide enough for a 16-character name and the quiet "new" mark; Index for the numeral,
 * its bar and the one-line sorted header "INDEX ↑".
 */

export type FrozenKey = 'rank' | 'depot' | 'index';
export type FrozenSize = 'compact' | 'wide';

export const FROZEN_KEYS: readonly FrozenKey[] = ['rank', 'depot', 'index'];

const WIDTH_REM: Readonly<Record<FrozenKey, Readonly<Record<FrozenSize, number>>>> = {
  rank: { compact: 4.75, wide: 4.75 },
  depot: { compact: 10, wide: 11 },
  index: { compact: 5.25, wide: 8.75 },
};

/** `px-3` on every table cell. */
export const CELL_PADDING_X_REM = 0.75;
const PX_PER_REM = 16;
/** The first cell's 2px left border (the selected-row bar) and Index's 1px right rule. */
const BORDER_PX: Readonly<Record<FrozenKey, number>> = { rank: 2, depot: 0, index: 1 };

export interface FrozenColumn {
  readonly key: FrozenKey;
  readonly leftRem: number;
  readonly widthRem: number;
  /** Room for the content once padding and borders are taken off. */
  readonly innerRem: number;
}

export function frozenLayout(size: FrozenSize): readonly FrozenColumn[] {
  return FROZEN_KEYS.reduce<{ readonly left: number; readonly columns: readonly FrozenColumn[] }>(
    (acc, key) => {
      const widthRem = WIDTH_REM[key][size];
      const innerRem = widthRem - 2 * CELL_PADDING_X_REM - BORDER_PX[key] / PX_PER_REM;
      return {
        left: acc.left + widthRem,
        columns: [...acc.columns, { key, leftRem: acc.left, widthRem, innerRem }],
      };
    },
    { left: 0, columns: [] },
  ).columns;
}

/** One frozen column of one size. */
export function frozenColumn(size: FrozenSize, key: FrozenKey): FrozenColumn {
  const found = frozenLayout(size).find((c) => c.key === key);
  if (!found) throw new Error(`Unknown frozen column ${key}`);
  return found;
}

export function frozenBlockRem(size: FrozenSize): number {
  return FROZEN_KEYS.reduce((sum, key) => sum + WIDTH_REM[key][size], 0);
}

const rem = (n: number): string => `${Math.round(n * 10_000) / 10_000}rem`;

/** The CSS properties the frozen classes read (`left-[var(--frozen-left)]` and so on). */
export function frozenStyle(
  compact: FrozenColumn,
  wide: FrozenColumn,
): Readonly<Record<string, string>> {
  return {
    '--frozen-left': rem(compact.leftRem),
    '--frozen-left-wide': rem(wide.leftRem),
    '--frozen-w': rem(compact.widthRem),
    '--frozen-w-wide': rem(wide.widthRem),
    '--frozen-inner': rem(compact.innerRem),
    '--frozen-inner-wide': rem(wide.innerRem),
  };
}

/** The properties for every frozen column, both sizes, keyed by column. */
export function frozenStyles(): Readonly<Record<FrozenKey, Readonly<Record<string, string>>>> {
  const style = (key: FrozenKey) => frozenStyle(frozenColumn('compact', key), frozenColumn('wide', key));
  return { rank: style('rank'), depot: style('depot'), index: style('index') };
}

/*
 * Every column after the frozen block, with the width it needs, so no column is cut and
 * the table never scrolls sideways: each width is the larger of its header (11px mono
 * uppercase at 0.12em tracking, about 7.92px a character, plus the 16px sort-arrow slot)
 * and its widest cell, plus the 24px side padding. Cells carry the value only: the
 * difference from the peer median is in the breakdown. A column shows from its tier up:
 * `sm` from 640px (the 800 and 1024 frames, 750 and 774px), `xl` from 1280px (998px), `full`
 * from 1424px (the 1440 frame is 1,158px). Below 640px only the frozen block shows.
 */

export type ColumnTier = 'sm' | 'xl' | 'full';
export type ScrollingKey = DeiComponentKey | 'trend' | 'fleet' | 'open';

export interface ScrollingColumn {
  readonly key: ScrollingKey;
  /** The visible header, short so it fits; the full name is in screen-reader text. */
  readonly header: string;
  readonly tier: ColumnTier;
  readonly widthPx: number;
}

const HEADER_CHAR_PX = 7.92;
const SORT_SLOT_PX = 16;
const PADDING_PX = 2 * CELL_PADDING_X_REM * PX_PER_REM;
/** "100.0%" in 13px mono. */
const RATE_CELL_PX = 6 * 7.8 + PADDING_PX;
/** The MODELLED pill in a header cell, with its 6px gap. */
const TAG_PILL_PX = 8 * HEADER_CHAR_PX + 16 + 2 + 6;
/** A 64px sparkline, an 8px gap and its four-weeks words capped at 80px. */
export const TREND_SPARK_PX = 64;
export const TREND_TEXT_MAX_PX = 80;
const TREND_CELL_PX = TREND_SPARK_PX + 8 + TREND_TEXT_MAX_PX + PADDING_PX;
/** The chevron column: a 12px chevron and 6px either side. */
export const OPEN_COLUMN_PX = 24;

const headerPx = (header: string, extra = 0): number =>
  header.length * HEADER_CHAR_PX + SORT_SLOT_PX + PADDING_PX + extra;

const metric = (key: DeiComponentKey, header: string, tier: ColumnTier): ScrollingColumn => ({
  key,
  header,
  tier,
  widthPx: Math.max(headerPx(header), RATE_CELL_PX),
});

export const LEAGUE_SCROLLING_COLUMNS: readonly ScrollingColumn[] = [
  metric('scheduled', 'Schedule', 'sm'),
  metric('deviceHealth', 'Devices', 'sm'),
  metric('onRoad', 'On road', 'sm'),
  metric('dark', 'Dark', 'xl'),
  metric('offRoad', 'Off road', 'xl'),
  { key: 'trend', header: 'Trend', tier: 'full', widthPx: Math.max(headerPx('Trend', TAG_PILL_PX), TREND_CELL_PX) },
  { key: 'fleet', header: 'Fleet', tier: 'full', widthPx: headerPx('Fleet') },
  { key: 'open', header: 'Breakdown', tier: 'sm', widthPx: OPEN_COLUMN_PX },
];

/** The display class that shows a column from its tier up (never the `hidden` attribute). */
export const TIER_CLASS: Readonly<Record<ColumnTier, string>> = {
  sm: 'hidden sm:table-cell',
  xl: 'hidden xl:table-cell',
  full: 'hidden min-[1424px]:table-cell',
};

const TIERS_SHOWN: Readonly<Record<ColumnTier | 'phone', readonly ColumnTier[]>> = {
  phone: [],
  sm: ['sm'],
  xl: ['sm', 'xl'],
  full: ['sm', 'xl', 'full'],
};

/** The table's whole width at a breakpoint, in px: the frozen block plus the columns shown. */
export function tableWidthPx(at: ColumnTier | 'phone'): number {
  const block = frozenBlockRem(at === 'phone' ? 'compact' : 'wide') * PX_PER_REM;
  return LEAGUE_SCROLLING_COLUMNS.filter((c) => TIERS_SHOWN[at].includes(c.tier)).reduce(
    (sum, c) => sum + c.widthPx,
    block,
  );
}
