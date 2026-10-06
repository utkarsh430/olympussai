import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DepotTable } from '@/components/depot/network/DepotTable';
import type { DepotRow } from '@/lib/depot/network/overviewModel';
import type { DepotSummary } from '@/lib/depot/types';

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };

function unitRow(i: number): DepotRow {
  const depot = {
    id: `u${i}`,
    name: `Unit ${i}`,
    kind: 'depot',
    fleet: 100 - i,
    reporting: 50,
    assigned: 20,
    centroid: null,
    status: { live: 10, stationary: 20, noSignal: 5, underMaintenance: 1 },
    states: { inService: 4, onRoad: 6, standing: 20, dark: 5, offRoad: 1 },
  } as unknown as DepotSummary;
  return { depot, score: null } as unknown as DepotRow;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  // A wide screen: the narrow column set is decided by a media query.
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('units table', () => {
  const rows = Array.from({ length: 30 }, (_, i) => unitRow(i));

  it('uses the shared table options: fixed rows and a frozen first column', () => {
    act(() => root.render(<DepotTable rows={rows} selectedId={null} onSelect={() => undefined} />));
    const table = container.querySelector('table');
    expect(table?.className).toContain('depot-table-fixed');
    expect(table?.className).toContain('depot-table-frozen');
  });

  const names = (): string[] =>
    Array.from(container.querySelectorAll('tbody tr')).map(
      (tr) => tr.querySelector('td:not(.depot-cell-expander)')?.textContent ?? '',
    );
  const pagerWords = (): string | null =>
    container.querySelector('[data-testid="depot-pager"] [role="status"]')?.textContent ?? null;
  const button = (name: string): HTMLButtonElement | undefined =>
    Array.from(container.querySelectorAll('button')).find((b) => b.textContent === name);

  it('pages at 25 with the shared pager as the only count, and no "Show all"', () => {
    act(() => root.render(<DepotTable rows={rows} selectedId={null} onSelect={() => undefined} />));
    expect(container.querySelectorAll('tbody tr')).toHaveLength(25);
    expect(pagerWords()).toBe('Rows 1 to 25 of 30');
    expect(container.textContent).not.toMatch(/Show all|Showing/);
    expect(container.querySelector('h2')?.textContent).toBe('All units');
    act(() => button('Next')?.click());
    expect(names()).toEqual(['Unit 25', 'Unit 26', 'Unit 27', 'Unit 28', 'Unit 29']);
    expect(pagerWords()).toBe('Rows 26 to 30 of 30');
  });

  it('draws no pager for a list of 25 or fewer', () => {
    act(() =>
      root.render(<DepotTable rows={rows.slice(0, 25)} selectedId={null} onSelect={() => undefined} />),
    );
    expect(container.querySelector('[data-testid="depot-pager"]')).toBeNull();
  });

  it('returns to page 1 when the kind filter changes', () => {
    act(() => root.render(<DepotTable rows={rows} selectedId={null} onSelect={() => undefined} />));
    act(() => button('Next')?.click());
    act(() => button('Operating depots')?.click());
    expect(pagerWords()).toBe('Rows 1 to 25 of 30');
    expect(names()[0]).toBe('Unit 0');
  });

  it('returns to page 1 when the sort changes', () => {
    act(() => root.render(<DepotTable rows={rows} selectedId={null} onSelect={() => undefined} />));
    act(() => button('Next')?.click());
    const unitHeader = Array.from(container.querySelectorAll('th button')).find((b) =>
      b.textContent?.startsWith('Unit'),
    ) as HTMLButtonElement;
    act(() => unitHeader.click());
    expect(pagerWords()).toBe('Rows 1 to 25 of 30');
  });

  it('brings the page of a unit selected elsewhere into view, and keeps it selected across pages', () => {
    act(() => root.render(<DepotTable rows={rows} selectedId={null} onSelect={() => undefined} />));
    // Selected from the map or a ranked list: Unit 28 is on page 2.
    act(() => root.render(<DepotTable rows={rows} selectedId="u28" onSelect={() => undefined} />));
    expect(pagerWords()).toBe('Rows 26 to 30 of 30');
    expect(container.querySelector('tr[aria-selected="true"]')?.textContent).toContain('Unit 28');
    act(() => button('Previous')?.click());
    expect(container.querySelector('tr[aria-selected="true"]')).toBeNull();
    act(() => button('Next')?.click());
    expect(container.querySelector('tr[aria-selected="true"]')?.textContent).toContain('Unit 28');
  });

  it('does not move the page when a row on the page is selected', () => {
    let selected: string | null = null;
    const draw = (): void =>
      root.render(
        <DepotTable
          rows={rows}
          selectedId={selected}
          onSelect={(id) => {
            selected = id;
          }}
        />,
      );
    act(draw);
    act(() => button('Next')?.click());
    (container.querySelectorAll('tbody tr')[1] as HTMLElement).click();
    expect(selected).toBe('u26');
    act(draw);
    expect(pagerWords()).toBe('Rows 26 to 30 of 30');
  });
});
