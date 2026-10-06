/**
 * How a band of figures breaks into rows below 1024 px, and how much room each figure's
 * text gets (from 1024 every band of up to five sits on one row: the figures are a fixed
 * width that five of fit).
 *
 * - Below 640 px a band has two columns; an odd last figure spans the full row, so nothing
 *   sits alone in half a row (three go 2 + 1 spanning, five go 2 + 2 + 1 spanning).
 * - From 640 px five go 3 + 2 and three go 3: the widest real value (`618 → 591`, 148 px)
 *   fits the 170 px a third of the 640 px column leaves.
 * - Four go 2 + 2 below 768 px and 4 from 768: at 640 a quarter of the column leaves 119
 *   px, too little for the yard's `142 of 208` (144 px); at 768 a quarter leaves 151.
 *
 * Values never truncate: on a phone a value is one type step smaller (20 px, not 24), which
 * the widest values need at 360 px, and a value wider than its cell wraps rather than cut.
 *
 * The grid classes are written out because Tailwind reads class names literally; a test
 * ties each class to the column count this model decides.
 */
import { BREAKPOINT_PX, contentWidthAt } from './geometry';

/** Below 640 px, 640 to 767, 768 to 1023, and from 1024 (one left-packed row). */
export type BandWidthTier = 'phone' | 'narrowTablet' | 'tablet' | 'desktop';

/** The most figures a band holds. */
export const MAX_BAND_FIGURES = 5;

/** Tailwind's `md` breakpoint, from which a band of four sits on one row. */
export const BAND_FOUR_ACROSS_FROM_PX = 768;

/** A figure's 1 px hairline on its left and its 16 px padding each side (`border-l px-4`). */
export const FIGURE_HAIRLINE_PX = 1;
export const FIGURE_PADDING_PX = 16;

/** The list is the column plus 17 px: it is pulled left to hide the first hairline. */
export const BAND_PULL_PX = FIGURE_PADDING_PX + FIGURE_HAIRLINE_PX;

/** A figure's fixed width from 1024, 1280 and 1440 px (`lg:w-[192px]` and so on). */
export const DESKTOP_FIGURE_WIDTH_PX = { lg: 192, xl: 200, wide: 232 } as const;

/** The value's type size: 20 px on a phone (`text-xl`), 24 px from 640 (`sm:text-2xl`). */
export const FIGURE_VALUE_PX = { phone: 20, other: 24 } as const;

/** A caption wraps to at most this many lines; it is never cut with an ellipsis. */
export const CAPTION_MAX_LINES = 2;

export function bandWidthTier(viewportPx: number): BandWidthTier {
  if (viewportPx < BREAKPOINT_PX.sm) return 'phone';
  if (viewportPx < BAND_FOUR_ACROSS_FROM_PX) return 'narrowTablet';
  if (viewportPx < BREAKPOINT_PX.lg) return 'tablet';
  return 'desktop';
}

/** The grid columns a band of `count` figures takes at a width tier below 1024 px. */
export function figureBandColumns(count: number, tier: BandWidthTier): number {
  if (count <= 1) return 1;
  if (tier === 'phone') return 2;
  if (count === 4) return tier === 'narrowTablet' ? 2 : 4;
  return Math.min(count, 3);
}

/** True when the last figure spans the full row (it would otherwise sit alone in half of it). */
export function figureBandLastSpans(count: number, tier: BandWidthTier): boolean {
  const columns = figureBandColumns(count, tier);
  return columns === 2 && count % 2 === 1 && count > 1;
}

/** The figures on each row, in order, for `count` figures in `columns` columns. */
export function figureBandRows(count: number, columns: number): readonly number[] {
  const rows = Math.ceil(count / columns);
  return Array.from({ length: rows }, (_row, index) =>
    Math.min(columns, count - index * columns),
  );
}

function desktopFigureWidth(viewportPx: number): number {
  if (viewportPx >= 1440) return DESKTOP_FIGURE_WIDTH_PX.wide;
  if (viewportPx >= BREAKPOINT_PX.xl) return DESKTOP_FIGURE_WIDTH_PX.xl;
  return DESKTOP_FIGURE_WIDTH_PX.lg;
}

/** The room for the text of figure `index` (0-based) in a band of `count`, at a viewport width. */
export function figureTextWidth(count: number, index: number, viewportPx: number): number {
  const tier = bandWidthTier(viewportPx);
  const inset = FIGURE_HAIRLINE_PX + 2 * FIGURE_PADDING_PX;
  if (tier === 'desktop') return desktopFigureWidth(viewportPx) - inset;
  const columns = figureBandColumns(count, tier);
  const list = contentWidthAt(viewportPx) + BAND_PULL_PX;
  const spans = index === count - 1 && figureBandLastSpans(count, tier);
  return (spans ? list : list / columns) - inset;
}

/**
 * A value's drawn width in the mono face (JetBrains Mono: every glyph 0.6 em) at a type
 * size. The arrow falls back to a wider face: measured at 1.4 em in the browser.
 */
export function figureValueWidth(value: string, typePx: number): number {
  return [...value].reduce((sum, glyph) => sum + (glyph === '→' ? 1.4 : 0.6) * typePx, 0);
}

/** The value's type size at a viewport width. */
export function figureValuePx(viewportPx: number): number {
  return viewportPx < BREAKPOINT_PX.sm ? FIGURE_VALUE_PX.phone : FIGURE_VALUE_PX.other;
}

const PHONE_GRID: Readonly<Record<number, string>> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
};

const NARROW_TABLET_GRID: Readonly<Record<number, string>> = {
  1: 'sm:grid-cols-1',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
};

const TABLET_GRID: Readonly<Record<number, string>> = {
  1: 'md:grid-cols-1',
  2: 'md:grid-cols-2',
  3: 'md:grid-cols-3',
  4: 'md:grid-cols-4',
};

/**
 * Below 1024 px a figure spans three rows of the band's grid (label, value, caption) and
 * takes them as its own through a subgrid, so the tallest label in a row sets that row's
 * label height for every figure in it: when one label wraps to two lines, the values in
 * the row still sit level. The band's 12 px row gap stays between rows of figures; inside
 * a figure the gap is 0 and the value and caption keep their own 6 px margins. A figure
 * that is a link or a toggle passes the rows on to its control with the same classes.
 * From 1024 the band is one flex row and a figure is an ordinary block.
 */
export const FIGURE_ROWS_CLASSES = 'max-lg:row-span-3 max-lg:grid max-lg:grid-rows-subgrid max-lg:gap-y-0';

/** The last figure spans both phone columns; from 640 it takes one column again. */
export const LAST_SPANS_CLASSES = '[&>li:last-child]:col-span-2 sm:[&>li:last-child]:col-span-1';

/** The grid classes below 1024 for a band of `count` figures. */
export function figureBandGridClasses(count: number): string {
  const phone = PHONE_GRID[figureBandColumns(count, 'phone')] ?? 'grid-cols-1';
  const narrow = NARROW_TABLET_GRID[figureBandColumns(count, 'narrowTablet')] ?? 'sm:grid-cols-1';
  const tablet = TABLET_GRID[figureBandColumns(count, 'tablet')] ?? 'md:grid-cols-1';
  const span = figureBandLastSpans(count, 'phone') ? ` ${LAST_SPANS_CLASSES}` : '';
  return `${phone} ${narrow} ${tablet}${span}`;
}
