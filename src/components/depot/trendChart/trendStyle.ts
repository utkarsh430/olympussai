import { DEPOT_PALETTE, meaningColour } from '@/lib/depot/palette';

/**
 * Chart colours as values, for the SVG attributes Recharts writes, taken from
 * the depot palette (the command centre's tokens) because a chart library cannot
 * read a Tailwind class. The meaning table's chart series: history cyan over a cyan
 * gradient fill (as the dashboard's GPS stream), the forecast and its band teal (as its
 * demand curve), the "now" marker amber. History, live and forecast are also told apart
 * by line style and a word, never by colour alone.
 */
export const TREND_COLOUR = {
  /** holo-glow: the history line and its gradient fill. */
  history: meaningColour('history'),
  /** holo-glow: the live point. */
  accent: DEPOT_PALETTE.glow,
  /** holo-teal: the forecast line and its band. */
  forecast: meaningColour('forecast'),
  /** depot-line: hairline grid. */
  grid: DEPOT_PALETTE.line,
  /** depot-muted: axis text that must be read at 11px (about 7:1 on the page). */
  axisText: DEPOT_PALETTE.label,
  /** alert-amber: the "now" marker. */
  now: meaningColour('now'),
  /** depot-page: the ring around the live marker. */
  surface: DEPOT_PALETTE.page,
} as const;

/** The band is a wash of the accent, never a solid block. */
export const BAND_OPACITY = 0.14;
/** The history's fill: the line's colour fading to nothing at the axis. */
export const HISTORY_FILL_TOP = 0.26;
/** A wide faint copy under a line draws its glow without a blur filter. */
export const GLOW_WIDTH = 6;
export const GLOW_OPACITY = 0.16;
export const FORECAST_DASH = '6 4';
/** Nothing below 11px, axis ticks included. */
export const AXIS_FONT_SIZE = 11;
