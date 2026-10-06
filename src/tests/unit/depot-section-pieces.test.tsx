import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Figure, FigureBand } from '@/components/depot/shell/FigureBand';
import { Notice } from '@/components/depot/shell/Notice';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';

afterEach(cleanup);

describe('SectionLabel', () => {
  it('writes the count after the label at the requested level', () => {
    render(<SectionLabel label="Exceptions" count={1049} level={3} note="Nearest first" />);
    const heading = screen.getByRole('heading', { level: 3 });
    expect(heading.textContent).toBe('Exceptions · 1,049');
    expect(screen.getByText('Nearest first')).toBeTruthy();
  });

  it('carries a tag only when one is passed', () => {
    const { rerender } = render(<SectionLabel label="Bays" />);
    expect(screen.queryByTestId('depot-provenance')).toBeNull();
    rerender(<SectionLabel label="Bays" tag="modelled" />);
    expect(screen.getByTestId('depot-provenance').textContent).toBe('MODELLED');
  });

  it('holds the controls of a section in its right slot, after the note, inside the label row', () => {
    // A view toggle or a filter belongs to its section's label row; without a slot a page
    // has to lay it over the row with absolute positioning.
    render(
      <SectionLabel
        label="Duty timeline"
        note="Nearest first"
        controls={<button type="button">Table</button>}
      />,
    );
    const row = screen.getByTestId('depot-section-label');
    const slot = screen.getByTestId('depot-section-controls');
    expect(row.contains(slot)).toBe(true);
    expect(slot.contains(screen.getByRole('button', { name: 'Table' }))).toBe(true);
    expect(slot.className).toContain('shrink-0');
    const note = screen.getByText('Nearest first');
    expect(note.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders no controls slot when none are passed', () => {
    render(<SectionLabel label="Bays" />);
    expect(screen.queryByTestId('depot-section-controls')).toBeNull();
  });
});

describe('FigureBand', () => {
  it('lays figures out as a list with label, value and caption', () => {
    render(
      <FigureBand label="Fleet figures">
        <Figure label="Off the road" value="12" caption="of 143 buses" />
        <Figure label="Due soon" value="7" caption="next 500 km" tag="modelled" share={0.4} />
      </FigureBand>,
    );
    const band = screen.getByRole('list', { name: 'Fleet figures' });
    expect(band.children).toHaveLength(2);
    expect(screen.getByText('12').className).toContain('text-2xl');
    expect(screen.getByTestId('depot-provenance').textContent).toBe('MODELLED');
    expect(screen.getByTestId('depot-figure-share').getAttribute('style')).toContain('40%');
  });

  it('draws the hero figure in the display face at 32px', () => {
    render(<Figure label="Available" value="118" hero />);
    expect(screen.getByText('118').className).toContain('depot-hero-numeral');
  });

  it('clamps a share outside 0 to 1', () => {
    render(<Figure label="Capacity" value="140%" share={1.4} />);
    expect(screen.getByTestId('depot-figure-share').getAttribute('style')).toContain('100%');
  });
});

describe('Notice', () => {
  it('says its status as a word and is not sticky', () => {
    render(<Notice status="warning">Recommendation only: nothing is moved.</Notice>);
    const notice = screen.getByTestId('depot-notice');
    expect(notice.textContent).toContain('WARNING');
    expect(notice.className).not.toContain('sticky');
    expect(notice.getAttribute('role')).toBeNull();
  });

  it('announces a critical notice as an alert', () => {
    render(<Notice status="critical">The feed is down.</Notice>);
    expect(screen.getByRole('alert').textContent).toContain('CRITICAL');
  });
});
