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

  it('caps at 25 and opens all through one "Show all N" toggle', () => {
    act(() => root.render(<DepotTable rows={rows} selectedId={null} onSelect={() => undefined} />));
    expect(container.querySelectorAll('tbody tr')).toHaveLength(25);
    const toggle = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.startsWith('Show all 30'),
    );
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    act(() => toggle?.click());
    expect(container.querySelectorAll('tbody tr')).toHaveLength(30);
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
  });
});
