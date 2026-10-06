import { describe, expect, it } from 'vitest';
import colors from 'tailwindcss/colors';
import config from '../../../tailwind.config';

/**
 * Every depot text colour clears WCAG AA (4.5:1) on every depot surface, the dimmest
 * tier and the strongest cyan wash included. Alpha colours are composited over the
 * surface they sit on, the way the browser paints them, before the ratio is taken.
 */

type Rgba = readonly [number, number, number, number];

const AA = 4.5;
/** The tag and pill washes: a tone at 10% over the surface, as the dashboard badges. */
const TAG_WASH_ALPHA = 0.1;

const palette = config.theme.extend.colors;
const depot = palette.depot;

function parse(colour: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(colour);
  if (hex) {
    const n = parseInt(hex[1] as string, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = /^rgba?\(([^)]+)\)$/.exec(colour);
  if (!rgba) throw new Error(`Unreadable colour ${colour}`);
  const [r, g, b, a = 1] = (rgba[1] as string).split(',').map((part) => Number(part.trim()));
  return [r as number, g as number, b as number, a];
}

function over(top: Rgba, under: Rgba): Rgba {
  const a = top[3];
  const mix = (i: 0 | 1 | 2): number => a * top[i] + (1 - a) * under[i];
  return [mix(0), mix(1), mix(2), 1];
}

function withAlpha(colour: Rgba, alpha: number): Rgba {
  return [colour[0], colour[1], colour[2], alpha];
}

function luminance(colour: Rgba): number {
  const [r, g, b] = [0, 1, 2].map((i) => {
    const v = (colour[i] as number) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(text: Rgba, surface: Rgba): number {
  const shown = over(text, surface);
  const [hi, lo] = [luminance(shown), luminance(surface)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const PAGE = parse(depot.page);
/**
 * The page where the shell's backdrop (`.depot-shell::before` in globals.css) is
 * brightest: the cyan glow's centre (0.1) under a grid line (0.033).
 */
const BACKDROP_PEAK = over(
  parse('rgba(63, 240, 255, 0.033)'),
  over(parse('rgba(34, 217, 245, 0.1)'), PAGE),
);
const SURFACES: Readonly<Record<string, Rgba>> = {
  page: PAGE,
  'backdrop peak': BACKDROP_PEAK,
  surface: over(parse(depot.surface), PAGE),
  bar: over(parse(depot.bar), PAGE),
  raised: over(parse(depot.raised), PAGE),
  selected: over(parse(depot.selected), PAGE),
};

const TEXT: Readonly<Record<string, string>> = {
  'depot-ink': depot.ink,
  'depot-prose': depot.prose,
  'depot-muted': depot.muted,
  'depot-faint': depot.faint,
  'holo-glow': palette.holo.glow,
  'alert-amber': palette.alert.amber,
  'alert-crimson': palette.alert.crimson,
  'alert-green': palette.alert.green,
  /* The quiet REFERENCE tag. */
  'slate-400': colors.slate[400],
  /* Modelled money and energy, forecasts, the Intelligence rail tab. */
  'holo-teal': palette.holo.teal,
  /* The brand mark, sign-out and the System rail tab. */
  'ol-gold': palette.ol.gold,
  'ol-gold-light': palette.ol['gold-light'],
};

/**
 * Toned text on a wash of its own tone: the rail's category tones on the current tab
 * (20%, the strongest), and every figure tone on the hero figure's wash (13%, stronger
 * than a figure's 7% or a selected row's 10%).
 */
const TONE_WASHES: readonly (readonly [string, number])[] = [
  ...['holo-glow', 'alert-green', 'holo-teal', 'ol-gold'].map((t) => [t, 0.2] as const),
  ...['alert-amber', 'alert-crimson', 'slate-400'].map((t) => [t, 0.13] as const),
];

/** The tones that print a word on their own wash (provenance and feed tags). */
const TAG_TONES = ['holo-glow', 'alert-amber', 'alert-crimson', 'alert-green', 'slate-400'];

describe('depot palette contrast', () => {
  for (const [textName, textColour] of Object.entries(TEXT)) {
    for (const [surfaceName, surface] of Object.entries(SURFACES)) {
      it(`${textName} on ${surfaceName} clears ${AA}:1`, () => {
        expect(contrast(parse(textColour), surface)).toBeGreaterThanOrEqual(AA);
      });
    }
  }

  for (const tone of TAG_TONES) {
    for (const [surfaceName, surface] of Object.entries(SURFACES)) {
      it(`a ${tone} tag on its own wash over ${surfaceName} clears ${AA}:1`, () => {
        const text = parse(TEXT[tone] as string);
        const wash = over(withAlpha(text, TAG_WASH_ALPHA), surface);
        expect(contrast(text, wash)).toBeGreaterThanOrEqual(AA);
      });
    }
  }

  for (const [tone, alpha] of TONE_WASHES) {
    for (const [surfaceName, surface] of Object.entries(SURFACES)) {
      it(`${tone} on a ${alpha * 100}% wash of itself over ${surfaceName} clears ${AA}:1`, () => {
        const text = parse(TEXT[tone] as string);
        const wash = over(withAlpha(text, alpha), surface);
        expect(contrast(text, wash)).toBeGreaterThanOrEqual(AA);
      });
    }
  }

  it('composites an alpha colour before measuring it', () => {
    const halfWhite = parse('rgba(255, 255, 255, 0.5)');
    expect(contrast(halfWhite, PAGE)).toBeLessThan(contrast(parse('#ffffff'), PAGE));
  });
});
