import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(path.resolve(__dirname, '../../app/globals.css'), 'utf8');

/** The custom properties `.depot-shell` sets at a width: the base block, or a min-width query. */
function layersAt(minWidth: number | null): Readonly<Record<string, string>> {
  const pattern =
    minWidth === null
      ? /\n {2}\.depot-shell \{\n(\s+--depot-[\s\S]*?)\n {2}\}/
      : new RegExp(`@media \\(min-width: ${minWidth}px\\) \\{\\s*\\.depot-shell \\{([^}]*)\\}`);
  const body = pattern.exec(CSS)?.[1] ?? '';
  return Object.fromEntries(
    Array.from(body.matchAll(/(--depot-[a-z-]+):\s*([^;]+);/g), ([, name, value]) => [name, value]),
  );
}

describe('the depot sticky layers', () => {
  it('lets the bar scroll away below 640px, so nothing sticks above the strip', () => {
    const base = layersAt(null);
    expect(base['--depot-bar-h']).toBe('0px');
    expect(base['--depot-strip-h']).toBe('0px');
    expect(base['--depot-sticky-top']).toBe('calc(var(--depot-bar-h) + var(--depot-strip-h))');
  });

  it('sticks one 52px bar row and the 40px strip from 640 to 899px', () => {
    expect(layersAt(640)).toEqual({ '--depot-bar-h': '3.25rem', '--depot-strip-h': '2.5rem' });
  });

  it('sticks one 56px bar row beside the rail from 900px, with no strip in the stack', () => {
    expect(layersAt(900)).toEqual({
      '--depot-bar-h': '3.5rem',
      '--depot-nav-h': 'auto',
      '--depot-strip-h': '0px',
    });
  });
});
