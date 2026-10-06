/*
 * The three widths a table on the fuel, revenue, economics and trends pages is laid out
 * for (critique round 5, section 7). The side rail shows from 1280 px, so the content
 * frame is about 1,000 px at 1280 (and 1,160 at 1440), 976 px from 1024 to 1279, and
 * 752 px at 800. A table's column set for a tier must fit that tier's narrowest frame.
 */

export type TableTier = 'wide' | 'medium' | 'narrow';

/** The viewport widths where a tier starts. */
export const TIER_FROM_PX: Readonly<Record<Exclude<TableTier, 'narrow'>, number>> = {
  wide: 1280,
  medium: 1024,
};

/** The narrowest content frame of each tier, in px (1280, 1024 and 800 viewports). */
export const TIER_FRAME_PX: Readonly<Record<TableTier, number>> = {
  wide: 1000,
  medium: 976,
  narrow: 752,
};

export function tableTierFor(viewportPx: number): TableTier {
  if (viewportPx >= TIER_FROM_PX.wide) return 'wide';
  if (viewportPx >= TIER_FROM_PX.medium) return 'medium';
  return 'narrow';
}

/** Sum of the widths of the named columns (a column without a width counts as 0). */
export function columnSum(widths: Readonly<Record<string, number>>, keys: readonly string[]): number {
  return keys.reduce((sum, key) => sum + (widths[key] ?? 0), 0);
}
