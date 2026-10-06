import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import colors from 'tailwindcss/colors';
import config from '../../../tailwind.config';
import {
  DEPOT_CYAN_RAMP,
  DEPOT_INDEX_RAMP,
  DEPOT_MEANING_TONE,
  DEPOT_PALETTE,
  DEPOT_TONE_COLOUR,
  DEPOT_TONE_TEXT,
  meaningColour,
  indexRampColour,
} from '@/lib/depot/palette';
import { INDEX_BANDS } from '@/lib/depot/map/nodeStyle';
import { BUS_STATE_COLOUR } from '@/lib/depot/yard/yardModel';
import { BUS_STATE_SQUARE } from '@/components/depot/shell/BusStateMark';

const { depot, holo, alert, ol, void: voidColour } = config.theme.extend.colors;

/** Every file under a folder, recursively. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe('depot palette module', () => {
  it('restates the command centre tokens exactly', () => {
    expect(DEPOT_PALETTE.page).toBe(voidColour.DEFAULT);
    expect(DEPOT_PALETTE.page).toBe(depot.page);
    expect(DEPOT_PALETTE.surface).toBe(depot.surface);
    expect(DEPOT_PALETTE.ink).toBe(depot.ink);
    expect(DEPOT_PALETTE.label).toBe(depot.muted);
    expect(DEPOT_PALETTE.faint).toBe(depot.faint);
    expect(DEPOT_PALETTE.line).toBe(depot.line);
    expect(DEPOT_PALETTE.glow).toBe(holo.glow);
    expect(DEPOT_PALETTE.bright).toBe(holo.bright);
    expect(DEPOT_PALETTE.core).toBe(holo.core);
    expect(DEPOT_PALETTE.deep).toBe(holo.deep);
    expect(DEPOT_PALETTE.amber).toBe(alert.amber);
    expect(DEPOT_PALETTE.crimson).toBe(alert.crimson);
    expect(DEPOT_PALETTE.green).toBe(alert.green);
    expect(DEPOT_PALETTE.slate).toBe(colors.slate[400]);
    expect(DEPOT_PALETTE.teal).toBe(holo.teal);
    expect(DEPOT_PALETTE.gold).toBe(ol.gold);
    expect(DEPOT_PALETTE.goldLight).toBe(ol['gold-light']);
  });

  it('prints each tone with the Tailwind class of the same token', () => {
    const byClass: Readonly<Record<string, string>> = {
      'text-holo-glow': holo.glow,
      'text-alert-green': alert.green,
      'text-alert-amber': alert.amber,
      'text-slate-400': colors.slate[400],
      'text-alert-crimson': alert.crimson,
      'text-holo-teal': holo.teal,
    };
    for (const [tone, colour] of Object.entries(DEPOT_TONE_COLOUR)) {
      expect(byClass[DEPOT_TONE_TEXT[tone as keyof typeof DEPOT_TONE_TEXT]]).toBe(colour);
    }
  });

  it('gives each meaning one colour, the same one wherever it is drawn', () => {
    expect(DEPOT_MEANING_TONE).toEqual({
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
    });
    expect(BUS_STATE_COLOUR).toEqual({
      in_service: meaningColour('inService'),
      on_road: meaningColour('onRoad'),
      standing: meaningColour('standing'),
      dark: meaningColour('dark'),
      off_road: meaningColour('offRoad'),
    });
    expect(BUS_STATE_SQUARE).toEqual({
      in_service: 'bg-alert-green',
      on_road: 'bg-holo-glow',
      standing: 'bg-alert-amber',
      dark: 'bg-slate-400',
      off_road: 'bg-alert-crimson',
    });
  });

  it('has no purple or pink tone (the dashboard has none)', () => {
    for (const colour of Object.values(DEPOT_TONE_COLOUR)) {
      const n = parseInt(colour.slice(1), 16);
      const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      const max = Math.max(r, g, b);
      const span = max - Math.min(r, g, b);
      if (span === 0) continue;
      const sector = max === r ? (g - b) / span : max === g ? (b - r) / span + 2 : (r - g) / span + 4;
      const hue = (sector * 60 + 360) % 360;
      // Violet, purple, magenta and pink run from about 260 to 340 degrees.
      expect(hue >= 260 && hue <= 340).toBe(false);
    }
  });

  it('ramps from holo-deep to holo-glow, monotone in lightness', () => {
    const lightness = DEPOT_CYAN_RAMP.map((hex) => {
      const n = parseInt(hex.slice(1), 16);
      return ((n >> 16) & 255) * 0.2126 + ((n >> 8) & 255) * 0.7152 + (n & 255) * 0.0722;
    });
    expect(DEPOT_CYAN_RAMP[0]).toBe(holo.deep);
    expect(DEPOT_CYAN_RAMP[DEPOT_CYAN_RAMP.length - 1]).toBe(holo.glow);
    lightness.slice(1).forEach((value, i) => expect(value).toBeGreaterThan(lightness[i] as number));
  });

  it('ramps the index from deep crimson to green, each step lighter than the last', () => {
    const luminance = (hex: string): number => {
      const n = parseInt(hex.slice(1), 16);
      const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      }) as [number, number, number];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const steps = DEPOT_INDEX_RAMP.map(luminance);
    steps.slice(1).forEach((value, i) => expect(value).toBeGreaterThan(steps[i] as number));
    expect(DEPOT_INDEX_RAMP[1]).toBe(DEPOT_PALETTE.crimson);
    expect(DEPOT_INDEX_RAMP[2]).toBe(DEPOT_PALETTE.amber);
    expect(DEPOT_INDEX_RAMP[4]).toBe(DEPOT_PALETTE.green);
    expect(indexRampColour(0)).toBe(DEPOT_INDEX_RAMP[0]);
    expect(indexRampColour(59.9)).toBe(DEPOT_INDEX_RAMP[2]);
    expect(indexRampColour(100)).toBe(DEPOT_INDEX_RAMP[4]);
    expect(INDEX_BANDS.map((band) => band.fill)).toEqual([...DEPOT_INDEX_RAMP]);
  });

  it('is the only depot source file that writes a colour literal', () => {
    const roots = ['src/components/depot', 'src/lib/depot'].map((dir) => join(process.cwd(), dir));
    const offenders = roots
      .flatMap(filesUnder)
      .filter((file) => /\.(ts|tsx)$/.test(file) && !file.endsWith(join('depot', 'palette.ts')))
      .filter((file) => /['"`]#[0-9a-f]{3,8}['"`]|rgba?\(/i.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
