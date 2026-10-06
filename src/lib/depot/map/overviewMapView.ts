/**
 * How the overview's units map frames itself. Pure, so the choices are pinned by tests.
 *
 * At 1440 x 900 the map's top sits about 390 px down the page, and from `xl` its frame
 * grows with the selected-unit panel beside it, so its bottom edge falls below the fold.
 * The zoom control therefore sits in the TOP right corner, on the first screen whatever
 * the frame's height. The hover card holds the top left corner.
 */

export type ZoomCorner = 'RIGHT_TOP';

export const ZOOM_CONTROL_CORNER: ZoomCorner = 'RIGHT_TOP';

/** Space kept between the outermost units and the frame's edge when fitting. */
export const FIT_PADDING_PX = 24;

/** A single unit has no extent to fit; it is centred at this zoom instead. */
export const SINGLE_NODE_ZOOM = 9;

/** The zoom control's options, given the Maps API's `ControlPosition` values. */
export function zoomControlOptions(
  positions: Readonly<Record<ZoomCorner, number>>,
): { readonly position: number } {
  return { position: positions[ZOOM_CONTROL_CORNER] };
}

export interface FitState {
  /** The map has been fitted to the units once. */
  readonly fitted: boolean;
  /** A person has dragged or zoomed the map since. */
  readonly userMoved: boolean;
}

/**
 * Whether a change in the frame's size fits the map to the units again. The frame grows
 * and shrinks with the panel beside it, so a fit made at one height leaves the units off
 * centre at another; once a person has moved the map, their view is kept.
 */
export function refitOnResize(state: FitState): boolean {
  return state.fitted && !state.userMoved;
}
