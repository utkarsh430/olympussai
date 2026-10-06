/**
 * The depot module's colours as values, for what cannot take a Tailwind class: chart
 * SVG attributes, map overlays and their legends. They restate the command centre's
 * tokens in tailwind.config.ts (`void`, `holo`, `alert`, `depot`) once, so no depot
 * component keeps its own hex; depot-palette.test.ts holds every value to its token.
 */
export const DEPOT_PALETTE = {
  /** void / depot-page: the page, the basemap, the dark ring between map marks. */
  page: '#02040a',
  /** depot-surface: the hud-panel fill (chart tooltips, map cards). */
  surface: '#070f1d',
  /** depot-ink: the dashboard's light body ink. */
  ink: '#d6ecf7',
  /** depot-muted: holo-glow at 70%, the label colour (axis text that must be read). */
  label: '#2da9b6',
  /** depot-faint: holo-glow at 60%, the recessive tier. */
  faint: '#27929d',
  /** depot-line: the hairline. */
  line: 'rgba(63, 240, 255, 0.2)',
  /** holo-glow: the accent, a value, the selected mark. */
  glow: '#3ff0ff',
  /** holo-bright, holo-core, holo-deep: the cyan family's lighter-to-darker steps. */
  bright: '#22d9f5',
  core: '#0ea5c9',
  deep: '#075f77',
  /** alert-amber, alert-crimson, alert-green: the dashboard's status colours. */
  amber: '#ffb020',
  crimson: '#ff4d5e',
  green: '#2bff88',
  /** Tailwind slate-400: the quiet neutral (a dark bus, a balanced depot, REFERENCE). */
  slate: '#94a3b8',
} as const;

/**
 * An ordinal ramp in the dashboard's cyan, darkest for the lowest step: holo-deep, an
 * even step to holo-core, holo-core, holo-bright, then holo-glow. Single hue, monotone
 * lightness, so it reads as more and less, never as categories.
 */
export const DEPOT_CYAN_RAMP = ['#075f77', '#0a82a0', '#0ea5c9', '#22d9f5', '#3ff0ff'] as const;
