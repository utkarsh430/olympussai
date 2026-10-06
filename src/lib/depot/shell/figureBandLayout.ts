/**
 * How a band of figures breaks into rows below 1024 px (from 1024 every band of up to five
 * sits on one row: the figures are a fixed width that five of fit). A band never leaves one
 * figure alone on a row: four go 2 + 2 on a phone and 4 from 640; five go 3 + 2; three go
 * 3; two go 2.
 *
 * The grid classes are written out because Tailwind reads class names literally; a test
 * ties each class to the column count this model decides.
 */

/** Below 640 px (`phone`) or from 640 to 1023 px (`tablet`). */
export type BandWidthTier = 'phone' | 'tablet';

/** The most figures a band holds. */
export const MAX_BAND_FIGURES = 5;

/** The grid columns a band of `count` figures takes at a width tier. */
export function figureBandColumns(count: number, tier: BandWidthTier): number {
  if (count <= 1) return 1;
  if (count === 4) return tier === 'phone' ? 2 : 4;
  if (count >= MAX_BAND_FIGURES) return 3;
  return count;
}

/** The figures on each row, in order, for `count` figures in `columns` columns. */
export function figureBandRows(count: number, columns: number): readonly number[] {
  const rows = Math.ceil(count / columns);
  return Array.from({ length: rows }, (_row, index) =>
    Math.min(columns, count - index * columns),
  );
}

const PHONE_GRID: Readonly<Record<number, string>> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
};

const TABLET_GRID: Readonly<Record<number, string>> = {
  1: 'sm:grid-cols-1',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-4',
};

/** The grid classes below 1024 for a band of `count` figures. */
export function figureBandGridClasses(count: number): string {
  const phone = figureBandColumns(count, 'phone');
  const tablet = figureBandColumns(count, 'tablet');
  return `${PHONE_GRID[phone] ?? 'grid-cols-1'} ${TABLET_GRID[tablet] ?? 'sm:grid-cols-1'}`;
}
