import { BREAKPOINT_PX, contentWidthAt } from '../shell/geometry';

/*
 * The gap row under the hour chart's axis: one signed figure per hour column. On a wide
 * screen they sit on one line; on a phone a column is narrower than a two-digit gap, so
 * every other hour drops a line and each figure gets two columns of room. Nothing
 * shrinks below 11px and nothing is cut short.
 */

const HOURS = 24;
/** The plot's y-axis band, to the left of the first hour column. */
export const HOUR_PLOT_Y_AXIS_PX = 40;
/** The plot's right margin, after the last hour column. */
export const HOUR_PLOT_RIGHT_PX = 12;
/** Room a signed two-digit gap ("+12") takes at 11px, with a little air either side. */
export const GAP_CELL_MIN_PX = 22;

/** One hour column's width at a viewport width: the content column less the plot's bands, over 24. */
export function hourColumnPx(viewportPx: number): number {
  return (contentWidthAt(viewportPx) - HOUR_PLOT_Y_AXIS_PX - HOUR_PLOT_RIGHT_PX) / HOURS;
}

/** True when a gap per column would touch its neighbour, so the row takes two lines. */
export function gapRowStaggered(viewportPx: number): boolean {
  return hourColumnPx(viewportPx) < GAP_CELL_MIN_PX;
}

export type GapRowTier = 'single' | 'staggered';

/** For `useWidthTier`: one line from `sm`, two below it. */
export const GAP_ROW_TIERS: readonly (readonly [GapRowTier, number])[] = [
  ['single', BREAKPOINT_PX.sm],
  ['staggered', 0],
];
