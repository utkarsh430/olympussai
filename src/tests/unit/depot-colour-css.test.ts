import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(path.resolve(__dirname, '../../app/globals.css'), 'utf8');

/** The body of the first rule whose selector list is exactly `selector` (whitespace-insensitive). */
function rule(selector: string): string {
  const escaped = selector
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');
  return new RegExp(`(?:^|[\\n}])\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(CSS)?.[1] ?? '';
}

describe('the depot colour rules in globals.css', () => {
  it("draws a figure's accent bar inside its own tile, so a wrapped band never lends it to the figure above", () => {
    const body = rule('.depot-figure::before');
    const top = /\btop:\s*(-?\d+)(px)?\s*;/.exec(body);
    expect(top).not.toBeNull();
    expect(Number(top?.[1])).toBeGreaterThanOrEqual(0);
  });
});

describe('the selected row', () => {
  it('is the flat selected surface, with no gradient under its text', () => {
    const body = rule('.depot-row-selected');
    expect(body).toMatch(/\bbg-depot-selected\b/);
    expect(body).not.toMatch(/background-image|gradient/);
  });
});

describe('the page title in forced colours', () => {
  it('drops the gradient and prints the title in the text colour, never transparent', () => {
    const block = /@media \(forced-colors: active\)\s*\{\s*\.depot-title\s*\{([^}]*)\}/.exec(CSS);
    expect(block).not.toBeNull();
    expect(block?.[1]).toMatch(/background-image:\s*none/);
    expect(block?.[1]).toMatch(/-webkit-text-fill-color:\s*currentColor/);
  });
});

describe('a pressed figure filter', () => {
  it('draws a 2px underline in its tone', () => {
    expect(rule('.depot-figure-pressed')).toMatch(
      /box-shadow:\s*inset 0 -2px 0 0 rgb\(var\(--depot-tone\)\)/,
    );
  });
});
