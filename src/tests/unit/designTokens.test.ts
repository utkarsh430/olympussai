/**
 * The palette's contrast guarantees, enforced against the real stylesheet.
 *
 * ─── WHY THIS TEST EXISTS ────────────────────────────────────────────────
 *
 * Four implementers are building four dashboards on these tokens in
 * parallel, and a contrast ratio is exactly the kind of property that is
 * asserted once in a comment and then quietly broken by someone nudging a
 * hex to taste. Nothing else in this repo can catch it: typecheck, lint,
 * build and every unit test pass perfectly happily with unreadable text.
 *
 * So the ratios are not documentation here — they are parsed out of
 * `src/app/globals.css` and recomputed. Change a token and this test tells
 * you what it did.
 *
 * ─── WHAT IS ASSERTED, AND WHY EACH THRESHOLD ────────────────────────────
 *
 *   text tiers      >= 4.5:1  WCAG AA for body text, against BOTH the card
 *                             and the page ground, because a panel is not
 *                             the only place text lands. The third tier is
 *                             included deliberately: `subtle` labels which
 *                             reading is which, so it is content, not
 *                             decoration, and does not get a pass.
 *   --input         >= 3.0:1  WCAG 1.4.11. This is the control boundary —
 *                             what tells an operator where they may type.
 *                             Also checked against both grounds.
 *   --border        NOT checked against 3:1, on purpose. It is a region
 *                             divider; at 3:1 a dense table becomes a grid
 *                             of cages. It is checked only for being
 *                             DISTINGUISHABLE from its ground at all.
 *   button fills    >= 4.5:1  a filled button's label against its own fill.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

/** Pulls one `--token: H S% L%;` declaration out of a named block. */
function parseBlock(selector: string): Record<string, string> {
  // Both blocks live inside `@layer base { ... }`, so match from the
  // selector to the first closing brace that ends a declaration list.
  const pattern = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n  \\}`, 'm');
  const match = CSS.match(pattern);
  if (!match || match[1] === undefined) {
    throw new Error(`Could not find the ${selector} token block in globals.css`);
  }
  const body = match[1];
  const tokens: Record<string, string> = {};
  const decl = /--([a-z0-9-]+):\s*([^;]+);/g;
  let found: RegExpExecArray | null;
  while ((found = decl.exec(body)) !== null) {
    const name = found[1];
    const value = found[2];
    if (name && value) tokens[name] = value.trim();
  }
  return tokens;
}

function hslToRgb(triplet: string): [number, number, number] {
  const parts = triplet.split(/\s+/);
  const h = Number.parseFloat(parts[0] ?? '');
  const s = Number.parseFloat((parts[1] ?? '').replace('%', '')) / 100;
  const l = Number.parseFloat((parts[2] ?? '').replace('%', '')) / 100;
  if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(l)) {
    throw new Error(`Not an HSL triplet: "${triplet}"`);
  }
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return [(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255];
}

function luminance(triplet: string): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = hslToRgb(triplet);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const THEMES = [
  { name: 'light', tokens: parseBlock(':root') },
  { name: 'dark', tokens: parseBlock('\\.dark') },
] as const;

describe('design tokens', () => {
  it('defines both palettes', () => {
    for (const { name, tokens } of THEMES) {
      expect(Object.keys(tokens).length, `${name} palette is empty`).toBeGreaterThan(20);
    }
  });

  it('defines every COLOUR token in BOTH palettes, so none can fall back to the wrong theme', () => {
    const [light, dark] = THEMES;
    // Scoped to HSL-triplet tokens deliberately. `--radius` is genuinely
    // theme-independent and belongs in :root alone; requiring it in both
    // blocks would be asserting a mistake. What actually matters is that no
    // COLOUR is defined in only one palette — a token present only under
    // .dark silently inherits the light value in light mode, which is how a
    // supposedly themed component ends up with one hard-coded colour.
    const colourNames = (tokens: Record<string, string>) =>
      Object.entries(tokens)
        .filter(([, value]) => /^[\d.]+\s+[\d.]+%\s+[\d.]+%$/.test(value))
        .map(([name]) => name)
        .sort();

    expect(colourNames(dark.tokens)).toEqual(colourNames(light.tokens));
    // Guard against the filter silently matching nothing and passing vacuously.
    expect(colourNames(light.tokens).length).toBeGreaterThan(20);
  });

  describe.each(THEMES)('$name palette', ({ tokens }) => {
    const grounds = () => [
      { label: 'card', value: tokens.card as string },
      { label: 'page background', value: tokens.background as string },
    ];

    it.each(['foreground', 'muted-foreground', 'subtle'])(
      '--%s clears AA (4.5:1) on both the card and the page',
      (token) => {
        for (const ground of grounds()) {
          const ratio = contrast(tokens[token] as string, ground.value);
          expect(
            ratio,
            `--${token} is ${ratio.toFixed(2)}:1 on the ${ground.label} — below AA`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      },
    );

    it.each(['destructive', 'warning', 'success'])(
      '--%s clears AA (4.5:1) as text on a card',
      (token) => {
        const ratio = contrast(tokens[token] as string, tokens.card as string);
        expect(ratio, `--${token} is ${ratio.toFixed(2)}:1 on the card`).toBeGreaterThanOrEqual(
          4.5,
        );
      },
    );

    it('--input clears WCAG 1.4.11 (3:1) on both grounds a control can sit on', () => {
      // The page ground is the one that is easy to miss: a border tuned only
      // against the card passes review and then fails on every form that sits
      // directly on the page.
      for (const ground of grounds()) {
        const ratio = contrast(tokens.input as string, ground.value);
        expect(
          ratio,
          `--input is ${ratio.toFixed(2)}:1 on the ${ground.label} — a control boundary needs 3:1`,
        ).toBeGreaterThanOrEqual(3);
      }
    });

    it('--border stays a quiet region divider, not a control boundary', () => {
      // Asserted as an UPPER bound on purpose. If someone "fixes" --border to
      // 3:1 to match --input, every table turns into a grid of cages and the
      // two tokens stop meaning different things.
      const ratio = contrast(tokens.border as string, tokens.card as string);
      expect(ratio).toBeLessThan(3);
      expect(ratio).toBeGreaterThan(1.05);
    });

    it.each([
      ['primary', 'primary-foreground'],
      ['destructive', 'destructive-foreground'],
      ['success', 'success-foreground'],
      ['warning', 'warning-foreground'],
    ])('a filled %s button can be read', (fill, label) => {
      const ratio = contrast(tokens[fill] as string, tokens[label] as string);
      expect(ratio, `${label} on ${fill} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    });
  });
});
