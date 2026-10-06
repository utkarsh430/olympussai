import { DEPOT_PALETTE } from '@/lib/depot/palette';

/**
 * Chart colours as values, for the SVG attributes Recharts writes, taken from
 * the depot palette (the command centre's tokens) because a chart library cannot
 * read a Tailwind class. One hue for the one metric: modelled history in the
 * quieter label cyan, the live value and forecast in the accent. History, live and forecast are told apart by line
 * style and a word, never by colour alone.
 */
export const TREND_COLOUR = {
  /** depot-muted: the quieter tone for modelled history. */
  history: DEPOT_PALETTE.label,
  /** holo-glow: the live point, the forecast line and its band. */
  accent: DEPOT_PALETTE.glow,
  /** depot-line: hairline grid. */
  grid: DEPOT_PALETTE.line,
  /** depot-muted: axis text that must be read at 11px (about 7:1 on the page). */
  axisText: DEPOT_PALETTE.label,
  /** depot-faint: the "now" marker, recessive. */
  now: DEPOT_PALETTE.faint,
  /** depot-page: the ring around the live marker. */
  surface: DEPOT_PALETTE.page,
} as const;

/** The band is a wash of the accent, never a solid block. */
export const BAND_OPACITY = 0.14;
export const FORECAST_DASH = '6 4';
/** Nothing below 11px, axis ticks included. */
export const AXIS_FONT_SIZE = 11;
