import { DEPOT_PALETTE, meaningColour } from '@/lib/depot/palette';
import type { GapTone } from '@/lib/depot/service/hourChartModel';

/**
 * The hour chart's colours as values for the SVG attributes Recharts writes, from the
 * depot palette's meanings: deployed buses are a plain count (cyan), needed rests on the
 * demand forecast (teal, dashed, over a faint band), scheduled is the neutral ink in a
 * step line, the current hour is the amber "now", a short gap crimson (worse) and an
 * over gap green (better). Every series is also told apart by its mark and a word.
 */
export const HOUR_COLOUR = {
  deployed: meaningColour('count'),
  needed: meaningColour('forecast'),
  scheduled: DEPOT_PALETTE.ink,
  now: meaningColour('now'),
  grid: DEPOT_PALETTE.line,
  axisText: DEPOT_PALETTE.label,
  outline: DEPOT_PALETTE.faint,
} as const;

export const GAP_COLOUR: Readonly<Record<GapTone, string>> = {
  short: meaningColour('worse'),
  over: meaningColour('better'),
  even: DEPOT_PALETTE.label,
};

/** Nothing below 11px, axis ticks and the gap row included. */
export const HOUR_AXIS_FONT_SIZE = 11;
export const NEEDED_DASH = '6 4';
export const NEEDED_BAND_OPACITY = 0.14;
/** The hatch: thin diagonal strokes this far apart, at this strength. */
export const HATCH_SPACING = 5;
export const HATCH_OPACITY = 0.7;
/** The not-observed column: an outline only, dashed so it never reads as a measured bar. */
export const OUTLINE_DASH = '3 2';
export const LINE_WIDTH = 2;
