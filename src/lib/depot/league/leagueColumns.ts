import type { DeiComponentKey } from '@/lib/depot/score/types';

/*
 * The league's frozen block (Rank, Depot, Index) decided in one place. A table cell's
 * width is only a hint to the browser: a header wider than its column (Rank with its
 * sort arrow) widened the column, the next frozen cell still stuck at the hinted offset,
 * and Rank's right-aligned digits slid under Depot. So every frozen cell gets the same
 * width, min and max, its content is boxed to the inner width below (padding and
 * borders taken off), and each `left` is the sum of the widths before it. Two sizes:
 * compact under 640px, so the block fits a phone's frame, and wide from 640px.
 */

export type FrozenKey = 'rank' | 'depot' | 'index';
export type FrozenSize = 'compact' | 'wide';

export const FROZEN_KEYS: readonly FrozenKey[] = ['rank', 'depot', 'index'];

const WIDTH_REM: Readonly<Record<FrozenKey, Readonly<Record<FrozenSize, number>>>> = {
  rank: { compact: 4.75, wide: 4.75 },
  depot: { compact: 8, wide: 13 },
  index: { compact: 7.5, wide: 9.5 },
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

/**
 * Metric columns after the frozen block: schedule coverage and device integrity first,
 * the two that most often explain a low index, so they are on screen at 1440 unscrolled.
 */
export const LEAGUE_COMPONENT_ORDER: readonly DeiComponentKey[] = [
  'scheduled',
  'deviceHealth',
  'onRoad',
  'dark',
  'offRoad',
];

/** Under 1024px only these metrics stay beside the frozen block; the breakdown has the rest. */
export const NARROW_COMPONENTS: ReadonlySet<DeiComponentKey> = new Set(['scheduled', 'deviceHealth']);
