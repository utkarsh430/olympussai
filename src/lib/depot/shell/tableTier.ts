/*
 * The three widths a table on the fuel, revenue, economics and trends pages is laid out
 * for. The side rail shows from 1280 px, so the content frame is 1,000 px at 1280 (and
 * 1,160 at 1440), 976 px from 1024 to 1279, and 752 px at 800 (all from the shell's
 * geometry). A table's column set for a tier must fit that tier's narrowest frame.
 */
import { BREAKPOINT_PX, contentWidthAt } from './geometry';

export type TableTier = 'wide' | 'medium' | 'narrow';

/** The viewport widths where a tier starts. */
export const TIER_FROM_PX: Readonly<Record<Exclude<TableTier, 'narrow'>, number>> = {
  wide: BREAKPOINT_PX.xl,
  medium: BREAKPOINT_PX.lg,
};

/** The viewport each tier is checked at: where it starts, and 800 for the narrow one. */
export const TIER_CHECK_VIEWPORT_PX: Readonly<Record<TableTier, number>> = {
  wide: TIER_FROM_PX.wide,
  medium: TIER_FROM_PX.medium,
  narrow: 800,
};

/** The narrowest content frame of each tier, in px (1280, 1024 and 800 viewports). */
export const TIER_FRAME_PX: Readonly<Record<TableTier, number>> = {
  wide: contentWidthAt(TIER_CHECK_VIEWPORT_PX.wide),
  medium: contentWidthAt(TIER_CHECK_VIEWPORT_PX.medium),
  narrow: contentWidthAt(TIER_CHECK_VIEWPORT_PX.narrow),
};

/** The tiers, widest first, each with the viewport width it starts at. */
export const TABLE_TIER_FROM_PX: ReadonlyArray<readonly [TableTier, number]> = [
  ['wide', TIER_FROM_PX.wide],
  ['medium', TIER_FROM_PX.medium],
  ['narrow', 0],
];

export function tableTierFor(viewportPx: number): TableTier {
  if (viewportPx >= TIER_FROM_PX.wide) return 'wide';
  if (viewportPx >= TIER_FROM_PX.medium) return 'medium';
  return 'narrow';
}
