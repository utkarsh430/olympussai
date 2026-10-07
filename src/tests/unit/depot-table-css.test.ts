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

describe('the table pieces in globals.css', () => {
  it('keeps the expander column at 24px with no padding, so the next frozen cell starts at 24px', () => {
    const body = rule('.depot-table .depot-cell-expander');
    expect(body).toMatch(/\bbox-border\b/);
    expect(body).toMatch(/\bw-6\b/);
    expect(body).toMatch(/\bpx-0\b/);
  });

  it('freezes cells by class, with solid backgrounds and the hairline on the last frozen one', () => {
    expect(rule('.depot-table-frozen .depot-cell-frozen')).toMatch(/\bsticky left-0\b/);
    expect(rule('.depot-table-frozen td.depot-cell-frozen')).toMatch(/\bbg-depot-page\b/);
    expect(rule('.depot-table-frozen th.depot-cell-frozen')).toMatch(/\bz-20\b/);
    expect(rule('.depot-table-frozen .depot-cell-frozen-edge')).toMatch(/border-r-depot-line/);
    expect(CSS).not.toMatch(/\.depot-table-frozen t[dh]:first-child/);
  });

  it('shows the row-end chevron only on hover and focus, muted', () => {
    expect(rule('.depot-row-chevron')).toMatch(/\bopacity-0\b/);
    expect(rule('.depot-row-chevron')).toMatch(/text-depot-muted/);
    expect(
      rule('.depot-row-selectable:hover .depot-row-chevron, .depot-row-selectable:focus-visible .depot-row-chevron'),
    ).toMatch(/opacity-100/);
  });

  it('draws a focused row’s ring inside the row, so the scrolling frame never clips it', () => {
    expect(rule('.depot-row-selectable:focus-visible')).toMatch(/outline-offset:\s*-2px/);
  });

  it('draws a table link cyan with no underline until hover or keyboard focus', () => {
    const body = rule('.depot-table-link');
    expect(body).toMatch(/text-holo-glow/);
    expect(body).toMatch(/\bno-underline\b/);
    expect(rule('.depot-table-link:hover, .depot-table-link:focus-visible')).toMatch(/\bunderline\b/);
  });

  it('keeps links in sentences underlined', () => {
    expect(rule(':where(.depot-prose, .depot-note) a')).toMatch(/\bunderline\b/);
  });
});
