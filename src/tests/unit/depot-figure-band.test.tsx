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
    expect(list.className).toContain('md:grid-cols-2');
    expect(list.className).toContain('lg:flex');
    expect(list.className).toContain('lg:flex-wrap');
  });

  it('draws a band value at 24px from 640px and one step smaller (20px) on a phone', () => {
    band();
    const classes = screen.getByText('39 of 41').className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(['text-xl', 'sm:text-2xl']));
    // The 28px line box holds at both sizes (a size class alone would reset it).
    expect(classes).toEqual(expect.arrayContaining(['leading-7', 'sm:leading-7']));
  });

  it('never cuts a value or a label: each wraps instead', () => {
    band();
    for (const text of ['39 of 41', 'Parked with a position']) {
      const classes = screen.getByText(text).className.split(/\s+/);
      expect(classes, text).not.toContain('truncate');
      expect(classes, text).toContain('break-words');
    }
  });

  it('lets a label and its tag wrap onto two lines rather than shrink the label', () => {
    render(
      <FigureBand label="Maintenance figures">
        <Figure label="Due soon" value="27" tag="modelled" />
      </FigureBand>,
    );
    const row = screen.getByText('Due soon').parentElement;
    expect(row?.className).toContain('flex-wrap');
    expect(row?.className).toContain('min-h-4');
    expect(row?.className.split(/\s+/)).not.toContain('h-4');
  });

  it('wraps a caption instead of cutting it with an ellipsis, at every width', () => {
    band();
    const caption = screen.getByText('no yard established yet today');
    const classes = caption.className.split(/\s+/);
    expect(classes).toContain('depot-caption');
    expect(classes).toContain('break-words');
    for (const cut of ['truncate', 'text-ellipsis', 'whitespace-nowrap', 'line-clamp-1', 'line-clamp-2']) {
      expect(classes.some((name) => name.endsWith(cut)), cut).toBe(false);
    }
  });

  it('aligns the figures in a row to the top, so a two-line caption moves no neighbour', () => {
    band();
    const classes = screen.getByTestId('depot-figure-band').className.split(/\s+/);
    expect(classes).toContain('items-stretch');
    expect(classes).not.toContain('items-center');
    expect(classes).not.toContain('items-end');
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

  it('shows the pressed state with its tone underline, not only in words', () => {
    const { rerender } = render(
      <FigureBand label="Bus exceptions">
        <Figure label="Long dark" value="12" onPress={vi.fn()} pressed={false} />
      </FigureBand>,
    );
    expect(screen.getByRole('button').className).not.toContain('depot-figure-pressed');
    rerender(
      <FigureBand label="Bus exceptions">
        <Figure label="Long dark" value="12" onPress={vi.fn()} pressed />
      </FigureBand>,
    );
    expect(screen.getByRole('button').className).toContain('depot-figure-pressed');
  });

  it('is plain text when given neither', () => {
    band();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

/** The classes that make an element take the band's label, value and caption rows as its own. */
const SUBGRID = ['max-lg:row-span-3', 'max-lg:grid', 'max-lg:grid-rows-subgrid'];

/** The grid items inside a figure (screen-reader text is positioned out of the grid). */
const tracksOf = (element: Element): readonly Element[] =>
  Array.from(element.children).filter((child) => !child.classList.contains('sr-only'));

describe('FigureBand: values in a row sit level', () => {
  it('gives every figure the band rows for its label, value and caption below 1024px', () => {
    render(
      <FigureBand label="Exception figures">
        <Figure label="High dark rate" value="7" caption="depots" title="Why" />
        <Figure label="High off-road rate" value="4" tag="modelled" share={0.4} caption="depots" />
        <Figure label="Low on-road share" value="1" />
      </FigureBand>,
    );
    for (const item of screen.getAllByRole('listitem')) {
      expect(item.className.split(/\s+/)).toEqual(expect.arrayContaining(SUBGRID));
      // Label, value, then the caption (with its share bar) in one track: never a fourth.
      expect(tracksOf(item).length).toBeLessThanOrEqual(3);
      expect(tracksOf(item)[0]?.classList.contains('depot-tag-row')).toBe(true);
    }
  });

  it('keeps the one-row desktop band as it was: the figures are blocks from 1024px', () => {
    band();
    for (const item of screen.getAllByRole('listitem')) {
      expect(item.className.split(/\s+/).filter((name) => name.startsWith('lg:'))).toEqual([
        'lg:w-[192px]',
        'lg:flex-none',
      ]);
    }
  });

  it('passes the rows through a figure that is a link or a toggle', () => {
    render(
      <FigureBand label="Bus exceptions">
        <Figure label="Power off" value="37" caption="buses" href="/project/depots/exceptions" />
        <Figure label="Long dark" value="12" caption="buses" onPress={() => undefined} />
      </FigureBand>,
    );
    for (const control of [screen.getByRole('link'), screen.getByRole('button')]) {
      expect(control.className.split(/\s+/)).toEqual(expect.arrayContaining(SUBGRID));
      expect(tracksOf(control)).toHaveLength(3);
    }
  });
});
