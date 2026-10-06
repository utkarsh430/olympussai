/**
 * Arithmetic for the horizontally scrolling navigation strips: whether more links
 * lie beyond either edge (so a cue can be shown) and where to scroll so the active
 * link is in view. Pure, so it is tested without a browser.
 */

/** Sub-pixel rounding in `scrollLeft` would otherwise show a cue at the very end. */
const EDGE_TOLERANCE_PX = 2;

export interface StripMetrics {
  readonly scrollLeft: number;
  readonly clientWidth: number;
  readonly scrollWidth: number;
}

export interface StripCue {
  /** Links are hidden beyond the left edge. */
  readonly before: boolean;
  /** Links are hidden beyond the right edge. */
  readonly after: boolean;
}

export function stripCue({ scrollLeft, clientWidth, scrollWidth }: StripMetrics): StripCue {
  const overflow = scrollWidth - clientWidth;
  if (overflow <= EDGE_TOLERANCE_PX) return { before: false, after: false };
  return {
    before: scrollLeft > EDGE_TOLERANCE_PX,
    after: scrollLeft < overflow - EDGE_TOLERANCE_PX,
  };
}

export interface ActiveItemMetrics {
  readonly itemLeft: number;
  readonly itemWidth: number;
  readonly clientWidth: number;
  readonly scrollWidth: number;
}

/** The scroll position that centres the active link, kept inside the strip's range. */
export function centredScrollLeft({
  itemLeft,
  itemWidth,
  clientWidth,
  scrollWidth,
}: ActiveItemMetrics): number {
  const centred = itemLeft + itemWidth / 2 - clientWidth / 2;
  const max = Math.max(0, scrollWidth - clientWidth);
  return Math.min(max, Math.max(0, Math.round(centred)));
}

/** How far a cue button moves the strip: most of a screenful, keeping one link as context. */
export function pageScrollDelta(clientWidth: number, direction: 'before' | 'after'): number {
  const step = Math.max(1, Math.round(clientWidth * 0.7));
  return direction === 'after' ? step : -step;
}
