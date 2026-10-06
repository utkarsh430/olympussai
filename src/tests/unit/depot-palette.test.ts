import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import colors from 'tailwindcss/colors';
import config from '../../../tailwind.config';
import { DEPOT_CYAN_RAMP, DEPOT_PALETTE } from '@/lib/depot/palette';

const { depot, holo, alert, void: voidColour } = config.theme.extend.colors;

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

  it('is the only depot source file that writes a colour literal', () => {
    const roots = ['src/components/depot', 'src/lib/depot'].map((dir) => join(process.cwd(), dir));
    const offenders = roots
      .flatMap(filesUnder)
      .filter((file) => /\.(ts|tsx)$/.test(file) && !file.endsWith(join('depot', 'palette.ts')))
      .filter((file) => /['"`]#[0-9a-f]{3,8}['"`]|rgba?\(/i.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
