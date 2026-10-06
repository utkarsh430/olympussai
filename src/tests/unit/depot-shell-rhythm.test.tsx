import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PageHeader } from '@/components/depot/shell/PageHeader';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';

const css = readFileSync(join(process.cwd(), 'src', 'app', 'globals.css'), 'utf8');

/** The body of one rule in the stylesheet, by its exact selector. */
function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  return start < 0 ? '' : css.slice(start, css.indexOf('}', start));
}

afterEach(cleanup);

/**
 * Vertical rhythm (design critique round 4, section 7), held by the shared pieces so a
 * page inherits it rather than hand-picking margins.
 */
describe('shared vertical rhythm', () => {
  it('stacks sections 40px apart, 28px on a phone', () => {
    expect(rule('.depot-stack > * + *')).toContain('mt-7');
    expect(rule('.depot-stack > * + *')).toContain('sm:mt-10');
  });

  it('puts 16px between a section hairline and its label, then 12px to the content', () => {
    render(<SectionLabel label="Exceptions" />);
    const label = screen.getByTestId('depot-section-label');
    expect(label.className).toContain('pt-4');
    expect(label.className).toContain('mb-3');
    expect(label.className).toContain('border-t');
  });

  it('sets table header cells to 32px and body rows to 36px', () => {
    expect(rule('.depot-table th')).toContain('h-8');
    expect(rule('.depot-table td')).toContain('h-9');
  });

  it('sets the header label 11/16 with 4px under it, and prose 14/20', () => {
    expect(rule('.depot-eyebrow')).toContain('leading-4');
    expect(rule('.depot-eyebrow')).toContain('mb-1');
    expect(rule('.depot-prose')).toContain('leading-5');
  });

  it('puts 8px between the title and the sentence, and 24px under the header', () => {
    render(<PageHeader title="Yard" description="Who is in the yard." eyebrow="Dhampur" />);
    expect(screen.getByText('Who is in the yard.').className).toContain('mt-2');
    expect(screen.getByTestId('depot-page-header').className).toContain('mb-6');
  });
});
