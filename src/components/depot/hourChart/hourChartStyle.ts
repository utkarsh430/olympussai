import { DEPOT_PALETTE, meaningColour } from '@/lib/depot/palette';
import type { GapTone } from '@/lib/depot/service/hourChartModel';

/**
 * The hour chart's colours as values for the SVG attributes Recharts writes, from the
 * depot palette's meanings: deployed buses are a plain count (cyan), needed rests on the
 * demand forecast (teal, dashed, over a faint band; the only dashed mark), scheduled is the neutral ink in a
 * step line, the current hour is the amber "now", a short gap crimson (worse) and an
 * over gap amber (standing: surplus buses are buses that could stand, not a good hour). Every series is also told apart by its mark and a word.
 */
export const HOUR_COLOUR = {
  deployed: meaningColour('count'),
  needed: meaningColour('forecast'),
  scheduled: DEPOT_PALETTE.ink,
  now: meaningColour('now'),
  grid: DEPOT_PALETTE.line,
  axisText: DEPOT_PALETTE.label,
  outline: DEPOT_PALETTE.faint,
  /** Drawn under each line, so a line crossing a solid cyan bar keeps a dark edge. */
  casing: DEPOT_PALETTE.page,
} as const;

export const GAP_COLOUR: Readonly<Record<GapTone, string>> = {
  short: meaningColour('worse'),
  over: meaningColour('standing'),
  even: DEPOT_PALETTE.label,
};

/** Nothing below 11px, axis ticks and the gap row included. */
export const HOUR_AXIS_FONT_SIZE = 11;
export const NEEDED_DASH = '6 4';
export const NEEDED_BAND_OPACITY = 0.14;
/** The hatch: thin diagonal strokes this far apart, at this strength. */
export const HATCH_SPACING = 5;
export const HATCH_OPACITY = 0.7;
export const LINE_WIDTH = 2;
/** The casing is a pixel wider each side than the line it sits under. */
export const CASING_WIDTH = LINE_WIDTH + 2;
