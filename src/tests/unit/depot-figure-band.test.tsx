import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Figure, FigureBand } from '@/components/depot/shell/FigureBand';

afterEach(cleanup);

function band(): void {
  render(
    <FigureBand label="Yard figures">
      <Figure label="Parked with a position" value="12" caption="no yard established yet today" />
      <Figure label="Capacity" value="39 of 41" caption="fleet against modelled bays" />
    </FigureBand>,
  );
}

/** FigureBand (design critique round 4, D): fixed-width, left-packed, 24px figures. */
describe('FigureBand', () => {
  it('gives every figure a fixed width from 1024px and never stretches it to fill the row', () => {
    band();
    for (const item of screen.getAllByRole('listitem')) {
      expect(item.className).toContain('xl:w-[232px]');
      expect(item.className).toContain('lg:w-[200px]');
      expect(item.className).toContain('lg:flex-none');
      expect(item.className).not.toContain('flex-1');
    }
  });

  it('wraps to two columns on a phone and three from 640px, so five figures read 3 + 2', () => {
    band();
    const list = screen.getByTestId('depot-figure-band');
    expect(list.className).toContain('grid-cols-2');
    expect(list.className).toContain('sm:grid-cols-3');
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
