import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Figure, FigureBand } from '@/components/depot/shell/FigureBand';
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
 * Vertical rhythm, held by the shared pieces so a
 * page inherits it rather than hand-picking margins.
 */
describe('shared vertical rhythm', () => {
  it('stacks sections 40px apart, 28px on a phone', () => {
    expect(rule('.depot-stack > * + *')).toContain('mt-7');
    expect(rule('.depot-stack > * + *')).toContain('sm:mt-10');
    expect(rule('.depot-stack > *')).toContain('!mb-0');
  });

  it('keeps a band wrapped in a stack child from adding its own margin to the 40px', () => {
    // Yard: the band sat in a wrapper div, so the stack dropped the wrapper's
    // margin but not the band's 24px, and the next rule landed about 64px down.
    render(
      <FigureBand label="Yard figures">
        <Figure label="Bays" value="1" />
      </FigureBand>,
    );
    const band = screen.getByTestId('depot-figure-band').parentElement;
    expect(band?.className).toContain('depot-band');
    expect(rule('.depot-stack .depot-band:last-child')).toContain('!mb-0');
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
