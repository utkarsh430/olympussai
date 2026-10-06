import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CollapsedSection } from '@/components/depot/shell/CollapsedSection';
import { HowProduced } from '@/components/depot/shell/HowProduced';
import { ExpandToggle } from '@/components/depot/shell/RowExpander';

afterEach(cleanup);

function expectMutedChevron(): void {
  const chevron = screen.getByTestId('depot-disclosure-chevron');
  expect(chevron.textContent).toBe('›');
  expect(chevron.className).toContain('text-depot-muted');
  expect(chevron.className).not.toContain('holo');
}

/** One disclosure glyph and one colour (critique round 4, G): the chevron, muted. */
describe('disclosure glyph', () => {
  it('HowProduced uses the shared chevron', () => {
    render(<HowProduced paragraphs={['A sentence.']} />);
    expectMutedChevron();
  });

  it('CollapsedSection uses the shared chevron, turned when open', () => {
    render(
      <CollapsedSection label="Parked" open onToggle={() => {}}>
        <p className="depot-prose">x</p>
      </CollapsedSection>,
    );
    expectMutedChevron();
    expect(screen.getByTestId('depot-disclosure-chevron').className).toContain('rotate-90');
  });

  it('the table row expander uses the shared chevron', () => {
    render(<ExpandToggle open={false} controls="x" label="Show details" onToggle={() => {}} />);
    expectMutedChevron();
  });

  it('the details summary class is muted, never cyan', () => {
    const css = readFileSync(join(process.cwd(), 'src', 'app', 'globals.css'), 'utf8');
    const start = css.indexOf('.depot-details > summary {');
    const body = css.slice(start, css.indexOf('}', start));
    expect(body).toContain('text-depot-muted');
    expect(body).not.toContain('holo');
  });
});
