import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MAP_DARK_STYLE, MAP_LIGHT_STYLE, MAP_THEME } from '@/lib/constants';
import {
  createFleetLayer,
  FLEET_PALETTE_DARK,
  FLEET_PALETTE_LIGHT,
} from '@/components/map/fleetCanvasLayer';
import { installFakeGoogleMaps, type FakeMapHarness } from '@/tests/helpers/fakeGoogleMap';
import type { MapVehicle } from '@/lib/maps/contract';
import { describeCalibrationSource, isDerivedCalibration } from '@/lib/ops/calibrationSource';

/**
 * What this lane decided, held as executable claims.
 *
 * The cinematic surfaces — the landing page, /login, /project/upsrtc and
 * /project/bunching — moved onto the shared foundation. Three of the
 * decisions that made that possible are invisible to typecheck, lint and
 * build, and would rot silently:
 *
 *   1. The theme pins are gone. A future edit that re-adds `dark` to a route
 *      group would take a whole surface back out of light mode and nothing
 *      would fail.
 *   2. The map has two of everything, because the basemap and the canvas
 *      marks are the only two things on that page CSS cannot reach. A
 *      half-swap is worse than no swap.
 *   3. `measured from the od timetable` was a false claim AND a leaked enum.
 *      A lookup that quietly loses a key would put it back.
 *
 * These read source files rather than rendering, deliberately: what is being
 * asserted is a property of the code, not of one render.
 */

const root = join(__dirname, '..', '..', '..');
const read = (relative: string) => readFileSync(join(root, relative), 'utf8');

/** Strip comments, so prose ABOUT a pin never reads as a pin. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '');
}

describe('the cinematic surfaces follow the theme', () => {
  /**
   * The foundation pinned three route groups to `.dark` as a holding
   * position it could not verify past. Unpinning them is the substance of
   * this lane; re-pinning any of them is how it would be undone.
   */
  const pinned: ReadonlyArray<[string, string]> = [
    ['the landing page and /login', 'src/app/(public)/layout.tsx'],
    ['the command centre', 'src/app/(protected)/project/upsrtc/layout.tsx'],
  ];

  for (const [label, path] of pinned) {
    it(`${label} does not pin a palette`, () => {
      const source = code(read(path));
      // A `dark` class token anywhere in the rendered markup re-declares the
      // whole token block for that subtree, so the theme toggle stops
      // reaching it. Matching the className strings rather than the word
      // means the long explanations of WHY the pin was removed do not trip
      // their own test.
      const classNames = [...source.matchAll(/className="([^"]*)"/g)].map((m) => m[1] ?? '');
      for (const value of classNames) {
        expect(value.split(/\s+/)).not.toContain('dark');
      }
    });
  }

  it('the landing page mounts the WebGL globe on the night ground only', () => {
    // The globe is drawn with additive blending: it works by ADDING light to
    // what is behind it, and there is nothing to add to white. Rather than
    // author a second three.js material set for one page, light mode gets the
    // static edition the design already had. If this guard goes, a light-mode
    // visitor sees a page that looks like it is loading something forever.
    const source = code(read('src/components/landing/CanvasMount.tsx'));
    expect(source).toMatch(/useTheme\(\)/);
    expect(source).toMatch(/resolved !== 'dark'/);
    expect(source).toMatch(/return null/);
  });

  it('the command centre keeps `zoom` and never grows a transform', () => {
    // Load-bearing, and the reason is not stylistic: the fleet canvas
    // projects in LAYOUT pixels. `transform: scale` leaves layout size
    // untouched and scales only visually, so every one of the ~9,200
    // chevrons slides off the road while the map underneath does not move.
    // `zoom` changes the real layout size, so the projection stays aligned.
    const source = read('src/app/(protected)/project/upsrtc/layout.tsx');
    expect(source).toMatch(/zoom:\s*1\.18/);
    expect(code(source)).not.toMatch(/transform:\s*['"`]?\s*scale/);
  });
});

describe('the map has two of everything, and they stay in step', () => {
  it('offers a basemap style per theme', () => {
    expect(MAP_THEME.dark.styles).toBe(MAP_DARK_STYLE);
    expect(MAP_THEME.light.styles).toBe(MAP_LIGHT_STYLE);
    expect(MAP_THEME.dark.backgroundColor).not.toBe(MAP_THEME.light.backgroundColor);
  });

  it('suppresses the same competing features in both', () => {
    // The fleet layer draws ~9,200 marks over this. Google's default map is
    // dense with restaurant pins and road shields, and each one competes with
    // a bus for the same pixels. A light basemap that quietly reinstated them
    // would make the day edition unreadable in a way no colour choice could
    // rescue — so the suppressions are asserted, not assumed.
    const hidden = (styles: google.maps.MapTypeStyle[]) =>
      styles
        .filter((entry) =>
          (entry.stylers as Array<Record<string, unknown>>).some((s) => s.visibility === 'off'),
        )
        .map((entry) => `${entry.featureType ?? '*'}:${entry.elementType ?? '*'}`)
        .sort();

    expect(hidden(MAP_LIGHT_STYLE)).toEqual(hidden(MAP_DARK_STYLE));
    expect(hidden(MAP_LIGHT_STYLE)).toContain('poi:*');
    expect(hidden(MAP_LIGHT_STYLE)).toContain('transit:*');
    expect(hidden(MAP_LIGHT_STYLE)).toContain('road:labels');
  });

  it('offers a mark palette per theme, covering every data quality', () => {
    for (const quality of ['good', 'degraded', 'stale'] as const) {
      expect(FLEET_PALETTE_DARK.quality[quality]).toBeTruthy();
      expect(FLEET_PALETTE_LIGHT.quality[quality]).toBeTruthy();
      // Different values, or one of the two grounds is being lied to.
      expect(FLEET_PALETTE_LIGHT.quality[quality]).not.toBe(FLEET_PALETTE_DARK.quality[quality]);
    }
    expect(FLEET_PALETTE_LIGHT.selected).not.toBe(FLEET_PALETTE_DARK.selected);
  });

  it('draws every mark against its own ground with real contrast', () => {
    // The measurement, not the intention. `#2bff88` — the night "good"
    // colour — is 1.19:1 against the day basemap's road white: nine thousand
    // buses would be invisible, and no test that only checked "a light
    // palette exists" would notice.
    const grounds = { dark: '#06080f', light: '#ffffff' } as const;
    const palettes = { dark: FLEET_PALETTE_DARK, light: FLEET_PALETTE_LIGHT } as const;

    for (const theme of ['dark', 'light'] as const) {
      const ground = grounds[theme];
      const marks = [...Object.values(palettes[theme].quality), palettes[theme].selected];
      for (const mark of marks) {
        // 3:1 — the WCAG 1.4.11 bar for a non-text graphic that carries
        // meaning, which is exactly what a vehicle chevron is.
        expect(contrast(mark, ground)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('swaps the basemap and the marks together, never one alone', () => {
    // A light basemap under night-neon chevrons is worse than either mismatch
    // on its own, so both live in one effect keyed on the resolved theme.
    const source = code(read('src/components/map/FleetMap.tsx'));
    expect(source).toMatch(/setOptions\(MAP_THEME\[resolved\]\)/);
    expect(source).toMatch(/setPalette\(/);
  });

  it('leaves the ops fleet map on the palette it already draws', () => {
    // The ops dashboards are another lane's work this week. Making the
    // palette a parameter WITH the night values as its default is what makes
    // this change safe to land beside them: a caller that passes nothing gets
    // pixel-identical output.
    expect(FLEET_PALETTE_DARK.quality.good).toBe('#2bff88');
    expect(FLEET_PALETTE_DARK.quality.degraded).toBe('#ffb020');
    expect(FLEET_PALETTE_DARK.quality.stale).toBe('#ff4d5e');
    expect(FLEET_PALETTE_DARK.selected).toBe('#3ff0ff');

    const layer = read('src/components/map/fleetCanvasLayer.ts');
    expect(layer).toMatch(/initialPalette: FleetLayerPalette = FLEET_PALETTE_DARK/);
  });
});

describe('the identity accent is a token, not a literal', () => {
  const css = read('src/app/globals.css');

  it('defines the brand in both palettes', () => {
    const light = css.slice(css.indexOf(':root'), css.indexOf('.dark {'));
    const dark = css.slice(css.indexOf('.dark {'));
    for (const block of [light, dark]) {
      expect(block).toMatch(/--brand:\s*[\d.]+\s+[\d.]+%\s+[\d.]+%/);
      expect(block).toMatch(/--brand-foreground:/);
    }
  });

  it('gives the brand a luminance the day ground can carry', () => {
    // #d6a13a is the Olympuss gold and it CANNOT be the light value: 2.33:1
    // on white, 2.07:1 on the page ground. It fails AA as text and fails
    // 1.4.11 as a control boundary. The identity is the hue; each theme
    // carries the luminance that hue needs.
    expect(contrast('#8a5a00', '#ffffff')).toBeGreaterThanOrEqual(4.5); // light card
    expect(contrast('#8a5a00', '#eef2f7')).toBeGreaterThanOrEqual(4.5); // light page
    expect(contrast('#d6a13a', '#070f1d')).toBeGreaterThanOrEqual(4.5); // dark card
    expect(contrast('#d6a13a', '#02040a')).toBeGreaterThanOrEqual(4.5); // dark page
    // And the button fill has to be readable, not just the text tier.
    expect(contrast('#ffffff', '#8a5a00')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('#02040a', '#d6a13a')).toBeGreaterThanOrEqual(4.5);
    // The literal that was there before, failing, so nobody restores it.
    expect(contrast('#d6a13a', '#ffffff')).toBeLessThan(3);
  });

  it('leaves no private landing palette behind', () => {
    // `ol-*` and `sim-*` were two more vocabularies for decisions the shared
    // tokens already carried. Deleting them is most of what "one product"
    // means here; a re-entry would be a second look growing back.
    const tailwind = read('tailwind.config.ts');
    expect(tailwind).not.toMatch(/^\s*ol: \{/m);
    expect(tailwind).not.toMatch(/^\s*sim: \{/m);
    expect(css).not.toMatch(/--ol-gold/);
    expect(css).not.toMatch(/\.sim-panel/);
  });
});

describe('the calibration source is described, not printed', () => {
  it('never calls a schedule-derived figure measured', () => {
    // The defect this replaced: `measured from the ${source.replace('_',' ')}`.
    // None of these is a measurement — every one is derived from published
    // schedule data — and the thresholds, the gap-consistency figure and the
    // extra-wait figure are all proportions of it, so the overstatement
    // propagates into every number on the page.
    for (const source of ['timetable', 'od_timetable', 'journey_span', 'fleet_span']) {
      const phrase = describeCalibrationSource(source);
      expect(phrase).toBeTruthy();
      expect(phrase).not.toMatch(/measured/i);
      expect(phrase).toMatch(/worked out from/);
    }
  });

  it('never leaks a raw enum', () => {
    // `.replace('_', ' ')` has no `g` flag, so `od_timetable` reached a depot
    // reader as "od timetable" — an enum with a cosmetic space in it, and
    // "od" is not a word an operations reader can be expected to expand.
    for (const source of [
      'timetable',
      'od_timetable',
      'journey_span',
      'fleet_span',
      'default',
      'none',
    ]) {
      const phrase = describeCalibrationSource(source) ?? '';
      expect(phrase).not.toMatch(/_/);
      // Not "must not contain the source word" — "the published timetable" is
      // the plain English for `timetable` and is exactly right. What must
      // never appear is the MANGLED enum: the underscore swapped for a space
      // and nothing else done to it.
      expect(phrase).not.toContain('od timetable');
      expect(phrase).not.toContain('journey span');
      expect(phrase).not.toContain('fleet span');
      expect(phrase).not.toMatch(/\bod\b/);
    }
  });

  it('says nothing at all for a source it does not recognise', () => {
    // The wire type is `z.string()`; the control service owns the enum and
    // may add to it. Silence is the correct answer to "where did this come
    // from?" when we do not know — a prettified unknown value is an invented
    // provenance claim.
    expect(describeCalibrationSource('some_future_source')).toBeNull();
    expect(describeCalibrationSource('')).toBeNull();
  });

  it('refuses to treat the placeholder source as derived', () => {
    // The control service's own migration says: "'default' — NOT DERIVED…
    // Consumers MUST treat 'default' as uncalibrated and not present its
    // thresholds, CV or EWT as measurements."
    expect(isDerivedCalibration('default')).toBe(false);
    expect(isDerivedCalibration('none')).toBe(false);
    expect(isDerivedCalibration('some_future_source')).toBe(false);
    expect(isDerivedCalibration('od_timetable')).toBe(true);
    expect(describeCalibrationSource('default')).toMatch(/placeholder/);
  });
});

// ── WCAG 2.1 relative luminance, computed rather than asserted ─────────────
function channel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const clean = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16));
  return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/**
 * The palette actually reaching the canvas, proved rather than grepped.
 *
 * This block exists because the browser could not answer the question. The
 * Google Maps key on this deployment is referrer-restricted to the live
 * origin, so a build served on any other port gets
 * `RefererNotAllowedMapError` and no basemap renders at all — meaning the one
 * thing I most wanted to see, nine thousand day-palette chevrons on a day
 * basemap, was not observable where I was allowed to run.
 *
 * A source-level assertion that `setPalette` is called is not a substitute:
 * it would pass just as happily if the palette never reached a fill. So this
 * drives the real renderer through the real `draw()` against the shared fake
 * Maps harness and reads the colours off the recorded fills.
 */
describe('the fleet palette reaches the canvas', () => {
  let harness: FakeMapHarness | null = null;

  afterEach(() => {
    harness?.restore();
    harness = null;
  });

  /** Deterministic spread across UP, one vehicle per data quality. */
  const fleet: MapVehicle[] = [
    { id: 'A', latitude: 26.8, longitude: 80.9, headingDegrees: 0, dataQuality: 'good' },
    { id: 'B', latitude: 26.9, longitude: 81.0, headingDegrees: 90, dataQuality: 'degraded' },
    { id: 'C', latitude: 27.0, longitude: 81.1, headingDegrees: 180, dataQuality: 'stale' },
  ];

  /** Every colour that reached the canvas this frame, however it was applied. */
  function paintedColours(): string[] {
    const recorded = harness!.context();
    return [...recorded.fills.map((f) => f.colour), ...recorded.strokes.map((s) => s.colour)];
  }

  it('paints the day colours when the day palette is handed in at construction', () => {
    harness = installFakeGoogleMaps();
    const layer = createFleetLayer<MapVehicle>(harness.map, () => {}, FLEET_PALETTE_LIGHT);
    layer.setVehicles(fleet);
    harness.flushFrames();

    // Fills AND strokes: quality is drawn as a shape as well as a colour now,
    // and `stale` is a hollow chevron, so its colour arrives as a stroke.
    const painted = paintedColours();
    expect(painted).toContain(FLEET_PALETTE_LIGHT.quality.good);
    expect(painted).toContain(FLEET_PALETTE_LIGHT.quality.degraded);
    expect(painted).toContain(FLEET_PALETTE_LIGHT.quality.stale);
    // And crucially, NOT the neon it would have drawn before this change.
    expect(painted).not.toContain(FLEET_PALETTE_DARK.quality.good);
  });

  it('repaints in the other palette when the operator flips the theme', () => {
    harness = installFakeGoogleMaps();
    const layer = createFleetLayer<MapVehicle>(harness.map, () => {}, FLEET_PALETTE_DARK);
    layer.setVehicles(fleet);
    harness.flushFrames();
    const before = harness.context().fills.length;

    layer.setPalette(FLEET_PALETTE_LIGHT);
    harness.flushFrames();

    const after = harness
      .context()
      .fills.slice(before)
      .map((f) => f.colour);
    expect(after.length).toBeGreaterThan(0);
    expect(after).toContain(FLEET_PALETTE_LIGHT.quality.good);
    expect(after).not.toContain(FLEET_PALETTE_DARK.quality.good);
  });

  it('still paints the night colours for a caller that asks for nothing', () => {
    // The ops dashboards. This is the assertion that makes the change safe to
    // land beside another lane working on them.
    harness = installFakeGoogleMaps();
    const layer = createFleetLayer<MapVehicle>(harness.map, () => {});
    layer.setVehicles(fleet);
    harness.flushFrames();

    const painted = paintedColours();
    expect(painted).toContain('#2bff88');
    expect(painted).toContain('#ffb020');
    // Stale is the hollow chevron, so its colour reaches the canvas as a
    // stroke rather than a fill — the palette is unchanged either way.
    expect(painted).toContain('#ff4d5e');
  });
});
