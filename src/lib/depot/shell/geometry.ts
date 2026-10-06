/**
 * The depot shell's geometry, in one place: the breakpoints it switches at, the rail's
 * width, the page gutters, and the content column those leave at a given viewport. Every
 * "no column is cut" layout test takes its frame from `contentWidthAt`, so a change to the
 * shell (a wider rail, a breakpoint moved) fails those tests instead of leaving them
 * passing against stale numbers.
 *
 * The shell's class names cannot be built from these values (Tailwind reads literal class
 * names from the source), so a test ties each literal class to its constant here.
 */

/** Tailwind's default breakpoints the shell and the pages switch at, in px. */
export const BREAKPOINT_PX = {
  sm: 640,
  lg: 1024,
  xl: 1280,
} as const;

/** The widest viewport the layouts are checked at; several tables add columns from here. */
export const WIDE_VIEWPORT_PX = 1440;

/** The left rail's width (`xl:w-[232px]` on `DepotNav`), shown from `xl`; below it the strip. */
export const RAIL_WIDTH_PX = 232;

/** The viewport width from which the rail shows. */
export const RAIL_FROM_PX = BREAKPOINT_PX.xl;

/** The main area's side gutter below `sm` (`px-4`) and from `sm` (`sm:px-6`), each side. */
export const GUTTER_PX = { base: 16, sm: 24 } as const;

/** A table's frame: the 1px hairline each side of the scroll container. */
export const TABLE_FRAME_BORDER_PX = 2;

/** One side's gutter at a viewport width. */
export function gutterAt(viewportPx: number): number {
  return viewportPx >= BREAKPOINT_PX.sm ? GUTTER_PX.sm : GUTTER_PX.base;
}

/** The rail's width at a viewport width: the full rail from `xl`, nothing below it. */
export function railWidthAt(viewportPx: number): number {
  return viewportPx >= RAIL_FROM_PX ? RAIL_WIDTH_PX : 0;
}

/** The content column's width at a viewport width: the viewport less the rail and both gutters. */
export function contentWidthAt(viewportPx: number): number {
  return viewportPx - railWidthAt(viewportPx) - 2 * gutterAt(viewportPx);
}

/** The room inside a bordered table frame at a viewport width (the content column less its hairlines). */
export function tableRoomAt(viewportPx: number): number {
  return contentWidthAt(viewportPx) - TABLE_FRAME_BORDER_PX;
}
