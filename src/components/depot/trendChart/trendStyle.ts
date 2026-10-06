/**
 * Chart colours as values, for the SVG attributes Recharts writes. They are
 * the brief's tokens (tailwind.config.ts `depot` and `holo`), restated
 * because a chart library cannot read a Tailwind class. One hue for the one
 * metric: modelled history in the quiet de-emphasis grey, the live value and
 * forecast in the accent. History, live and forecast are told apart by line
 * style and a word, never by colour alone.
 */
export const TREND_COLOUR = {
  /** depot-muted: the quieter tone for modelled history. */
  history: '#9bb0c7',
  /** holo-glow: the live point, the forecast line and its band. */
  accent: '#3ff0ff',
  /** depot-line: hairline grid. */
  grid: 'rgba(63, 240, 255, 0.12)',
  /** depot-muted: axis text that must be read at 11px (about 9:1 on the page). */
  axisText: '#9bb0c7',
  /** depot-faint: the "now" marker, recessive. */
  now: '#6b84a0',
  /** depot-page: the ring around the live marker. */
  surface: '#02040a',
} as const;

/** The band is a wash of the accent, never a solid block. */
export const BAND_OPACITY = 0.14;
export const FORECAST_DASH = '6 4';
/** Nothing below 11px, axis ticks included. */
export const AXIS_FONT_SIZE = 11;
