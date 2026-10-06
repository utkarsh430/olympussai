import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Figure, FigureBand } from '@/components/depot/shell/FigureBand';
import { contentWidthAt } from '@/lib/depot/shell/geometry';

afterEach(cleanup);

function band(): void {
  render(
    <FigureBand label="Yard figures">
      <Figure label="Parked with a position" value="12" caption="no yard established yet today" />
      <Figure label="Capacity" value="39 of 41" caption="fleet against modelled bays" />
    </FigureBand>,
  );
}

/** FigureBand: fixed-width, left-packed, 24px figures. */
describe('FigureBand', () => {
  it('gives every figure a fixed width from 1024px and never stretches it to fill the row', () => {
    band();
    for (const item of screen.getAllByRole('listitem')) {
      expect(item.className).toContain('lg:w-[192px]');
      expect(item.className).toContain('xl:w-[200px]');
      expect(item.className).toContain('min-[1440px]:w-[232px]');
      expect(item.className).toContain('lg:flex-none');
      expect(item.className).not.toContain('flex-1');
    }
  });

  it('fits five figures on one row at 1024, 1280 and 1440 now the rail shows only from 1280', () => {
    // Content width (viewport less rail and gutters) and figure width at each breakpoint;
    // the list is 17px wider than the column (the first figure's hidden hairline).
    const rows = [
      { content: contentWidthAt(1024), figure: 192 },
      { content: contentWidthAt(1280), figure: 200 },
      { content: contentWidthAt(1440), figure: 232 },
    ];
    for (const { content, figure } of rows) expect(5 * figure).toBeLessThanOrEqual(content + 17);
  });

  it('puts a band of two in two columns below 1024px, so neither sits alone', () => {
    band();
    const list = screen.getByTestId('depot-figure-band');
    expect(list.className).toContain('grid-cols-2');
    expect(list.className).toContain('sm:grid-cols-2');
    expect(list.className).toContain('lg:flex');
    expect(list.className).toContain('lg:flex-wrap');
  });

  it('draws every band figure at 24px', () => {
    band();
    expect(screen.getByText('39 of 41').className).toContain('text-2xl');
  });

  it('truncates the label and caption with their full text in title', () => {
    band();
    expect(screen.getByText('Parked with a position').getAttribute('title')).toBe('Parked with a position');
    const caption = screen.getByText('no yard established yet today');
    expect(caption.getAttribute('title')).toBe('no yard established yet today');
    expect(caption.className).toContain('truncate');
    expect(caption.className).toContain('depot-caption');
  });
});

describe('FigureBand: one tag for a whole generated band', () => {
  it('shows the band name and ONE tag on a line above the figures', () => {
    // A band of generated figures on a MIXED or DERIVED page: one tag for the band, not a
    // pill on each of its figures.
    render(
      <FigureBand label="Plan figures" tag="modelled">
        <Figure label="Short depots" value="10 → 0" />
        <Figure label="Buses moved" value="26" />
      </FigureBand>,
    );
    const head = screen.getByTestId('depot-figure-band-head');
    expect(head.textContent).toContain('Plan figures');
    expect(screen.getAllByTestId('depot-provenance')).toHaveLength(1);
    expect(head.contains(screen.getByTestId('depot-provenance'))).toBe(true);
  });

  it('draws no head line when the band carries no tag', () => {
    band();
    expect(screen.queryByTestId('depot-figure-band-head')).toBeNull();
  });
});

describe('Figure: a figure that leads somewhere', () => {
  it('is a link when given an href, named by its label and value', () => {
    render(
      <FigureBand label="Bus exceptions">
        <Figure label="Power off" value="37" href="/project/depots/exceptions?kind=power_off" />
      </FigureBand>,
    );
    const link = screen.getByRole('link', { name: /Power off\s*37/ });
    expect(link.getAttribute('href')).toBe('/project/depots/exceptions?kind=power_off');
  });

  it('is a toggle button when given onPress, and says whether it is pressed', () => {
    const onPress = vi.fn();
    const { rerender } = render(
      <FigureBand label="Bus exceptions">
        <Figure label="Long dark" value="12" onPress={onPress} pressed={false} />
      </FigureBand>,
    );
    const button = screen.getByRole('button', { name: /Long dark\s*12/ });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(button);
    expect(onPress).toHaveBeenCalledTimes(1);
    rerender(
      <FigureBand label="Bus exceptions">
        <Figure label="Long dark" value="12" onPress={onPress} pressed />
      </FigureBand>,
    );
    expect(screen.getByRole('button', { name: /Long dark\s*12/ }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('is plain text when given neither', () => {
    band();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
