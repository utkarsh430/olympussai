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
  /** holo-teal: the dashboard's demand curve; here money and energy, forecasts, planned transfers. */
  teal: '#2ef2c4',
  /** ol-gold, ol-gold-light: the brand's gold (the emblem and sign-out on the dashboard). */
  gold: '#d6a13a',
  goldLight: '#f3c86a',
} as const;

/** The six tones a figure, bar, mark or series may take; each is a dashboard colour. */
export type DepotTone = 'cyan' | 'green' | 'amber' | 'slate' | 'crimson' | 'teal';

export const DEPOT_TONE_COLOUR: Readonly<Record<DepotTone, string>> = {
  cyan: DEPOT_PALETTE.glow,
  green: DEPOT_PALETTE.green,
  amber: DEPOT_PALETTE.amber,
  slate: DEPOT_PALETTE.slate,
  crimson: DEPOT_PALETTE.crimson,
  teal: DEPOT_PALETTE.teal,
};

/** The Tailwind text class of each tone, for a word or figure printed in it. */
export const DEPOT_TONE_TEXT: Readonly<Record<DepotTone, string>> = {
  cyan: 'text-holo-glow',
  green: 'text-alert-green',
  amber: 'text-alert-amber',
  slate: 'text-slate-400',
  crimson: 'text-alert-crimson',
  teal: 'text-holo-teal',
};

/** What a colour may say on a depot page. */
export type DepotMeaning =
  | 'inService'
  | 'onRoad'
  | 'standing'
  | 'dark'
  | 'offRoad'
  | 'critical'
  | 'warning'
  | 'info'
  | 'better'
  | 'worse'
  | 'moneyEnergy'
  | 'plan'
  | 'count'
  | 'history'
  | 'forecast'
  | 'now'
  | 'threshold';

/**
 * The one table of colour meanings, the same on every page: a bus in service is green,
 * on the road cyan (the two sit side by side in every availability bar, so they need two
 * hues), standing amber, dark slate, off the road crimson; exceptions crimson, amber and
 * cyan by severity; a change green when it is better and crimson when worse, only where
 * more is unambiguously better; money and energy figures teal (the MODELLED tag, amber, says
 * they are modelled; teal says what they measure), a planned transfer's arc teal; a plain
 * count cyan; on a chart the history cyan, the forecast teal, the "now" marker amber and a threshold
 * crimson. A colour always sits beside a word that says the same thing.
 */
export const DEPOT_MEANING_TONE: Readonly<Record<DepotMeaning, DepotTone>> = {
  inService: 'green',
  onRoad: 'cyan',
  standing: 'amber',
  dark: 'slate',
  offRoad: 'crimson',
  critical: 'crimson',
  warning: 'amber',
  info: 'cyan',
  better: 'green',
  worse: 'crimson',
  moneyEnergy: 'teal',
  plan: 'teal',
  count: 'cyan',
  history: 'cyan',
  forecast: 'teal',
  now: 'amber',
  threshold: 'crimson',
};

/**
 * The class that sets a tone's `--depot-tone` (globals.css), spelt out so Tailwind keeps
 * the rules: a figure, a bar fill or a rail group draws its accent, wash and glow from it.
 */
export const DEPOT_TONE_CLASS: Readonly<Record<DepotTone | 'gold', string>> = {
  cyan: 'depot-tone-cyan',
  green: 'depot-tone-green',
  amber: 'depot-tone-amber',
  slate: 'depot-tone-slate',
  crimson: 'depot-tone-crimson',
  teal: 'depot-tone-teal',
  gold: 'depot-tone-gold',
};

/**
 * Each rail category's own colour, so a reader learns where they are: the depot's pages
 * green, Network cyan, Intelligence teal, System the brand gold. Structure, not status.
 */
export function navGroupToneClass(heading: string, isDepotGroup: boolean): string {
  if (isDepotGroup) return DEPOT_TONE_CLASS.green;
  if (heading === 'Intelligence') return DEPOT_TONE_CLASS.teal;
  if (heading === 'System') return DEPOT_TONE_CLASS.gold;
  return DEPOT_TONE_CLASS.cyan;
}

/** A meaning's text class (a word or figure printed in it). */
export function meaningTextClass(meaning: DepotMeaning): string {
  return DEPOT_TONE_TEXT[DEPOT_MEANING_TONE[meaning]];
}

/** A meaning's tone class (sets `--depot-tone` for an accent, wash, fill or glow). */
export function meaningToneClass(meaning: DepotMeaning): string {
  return DEPOT_TONE_CLASS[DEPOT_MEANING_TONE[meaning]];
}

/** A meaning's colour as a value (chart and map attributes). */
export function meaningColour(meaning: DepotMeaning): string {
  return DEPOT_TONE_COLOUR[DEPOT_MEANING_TONE[meaning]];
}

/**
 * An ordinal ramp in the dashboard's cyan, darkest for the lowest step: holo-deep, an
 * even step to holo-core, holo-core, holo-bright, then holo-glow. Single hue, monotone
 * lightness, so it reads as more and less, never as categories.
 */
export const DEPOT_CYAN_RAMP = ['#075f77', '#0a82a0', '#0ea5c9', '#22d9f5', '#3ff0ff'] as const;

/**
 * The index ramp, worst to best: deep crimson, the dashboard's crimson, its amber, a soft
 * green, then its green. Each step is lighter than the last (relative luminance about
 * 0.10, 0.27, 0.52, 0.64, 0.74), so "lighter is better" stays true, the order reads in
 * greyscale and for red-green colour-blind readers, and on the dark map the bands read
 * as the dashboard's good-to-bad colours. One scale for "index" everywhere: the overview
 * map's nodes, its highest and lowest dots, and the league and economics index bars.
 */
export const DEPOT_INDEX_RAMP = [
  '#a3283a',
  DEPOT_PALETTE.crimson,
  DEPOT_PALETTE.amber,
  '#7fe6a6',
  DEPOT_PALETTE.green,
] as const;

/** Index bands are 20 points wide; 100 falls in the top band. */
const INDEX_BAND_WIDTH = 20;

/** The ramp colour for an index from 0 to 100 (the same bands as the map legend). */
export function indexRampColour(index: number): string {
  const step = Math.floor(Math.min(100, Math.max(0, index)) / INDEX_BAND_WIDTH);
  return DEPOT_INDEX_RAMP[Math.min(step, DEPOT_INDEX_RAMP.length - 1)] as string;
}

/**
 * A colour as the `--depot-tone` channels ("255 77 94"), so a bar fill drawn by
 * `.depot-bar-fill` (its gradient and glow read `--depot-tone`) can take a ramp colour.
 */
export function toneChannels(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}
