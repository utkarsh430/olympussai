import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DepotMapPanel } from '@/components/depot/network/DepotMapPanel';
import { ExceptionSummary } from '@/components/depot/network/ExceptionSummary';
import { SelectionBar } from '@/components/depot/network/SelectionBar';
import type { DepotRow } from '@/lib/depot/network/overviewModel';
import type { DepotSummary } from '@/lib/depot/types';
import type { ExceptionKind, ExceptionSeverity } from '@/lib/depot/exceptions/types';
import type { DepotScore } from '@/lib/depot/score/types';

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };

function depot(id: string, overrides: Partial<DepotSummary> = {}): DepotSummary {
  return {
    id,
    name: `Depot ${id}`,
    kind: 'depot',
    fleet: 40,
    status: { live: 20, stationary: 10, noSignal: 5, underMaintenance: 5, unknown: 0 },
    states: { inService: 15, onRoad: 5, standing: 10, dark: 5, offRoad: 5 },
    reporting: 35,
    positioned: 35,
    assigned: 20,
    powerCut: 0,
    tamperFlagged: 0,
    centroid: { lat: 26.8, lng: 80.9 },
    ...overrides,
  };
}

function score(depotId: string, index: number): DepotScore {
  return {
    depotId,
    peerGroup: 'medium',
    ranked: true,
    reason: 'ok',
    index,
    rank: 3,
    peerCount: 12,
    components: [],
  };
}

const A: DepotRow = { depot: depot('a'), score: score('a', 62.4) };
const B: DepotRow = { depot: depot('b'), score: score('b', 40.1) };
const ROWS: readonly DepotRow[] = [A, B];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function click(el: Element | null | undefined): void {
  if (!el) throw new Error('element not found');
  act(() => {
    (el as HTMLElement).click();
  });
}

function button(label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll('button')).find((b) => b.textContent === label);
}

function Host({ initial }: { readonly initial: DepotRow | null }) {
  const [row, setRow] = useState<DepotRow | null>(initial);
  return (
    <DepotMapPanel
      row={row}
      rows={ROWS}
      onSelect={() => undefined}
      onClear={() => setRow(null)}
    />
  );
}

describe('clearing the selection keeps keyboard focus on the page', () => {
  // Round 2: the line above the map ("No unit selected." / "Clear selection") is gone;
  // the panel says the selection once and its Clear keeps focus.
  it('moves focus to the selected-unit heading after the panel\'s "Clear"', () => {
    act(() => root.render(<Host initial={A} />));
    const clear = button('Clear');
    clear?.focus();
    click(clear);
    expect(document.activeElement).toBe(container.querySelector('#depot-panel-heading'));
  });

  it('still announces the change in the status line', () => {
    act(() => root.render(<Host initial={A} />));
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toBe('Selected Depot a, index 62.4');
    click(button('Clear'));
    expect(container.querySelector('[role="status"]')?.textContent).toBe('No unit selected');
  });
});

describe('SelectionBar', () => {
  it('links to the depot and offers the map, and has no clear control of its own', () => {
    act(() => root.render(<SelectionBar row={A} />));
    const link = Array.from(container.querySelectorAll('a')).find(
      (a) => a.textContent === 'Open depot',
    );
    expect(link?.getAttribute('href')).toMatch(/depot/);
    expect(button('Show on map')).toBeDefined();
  });

  it('gives the unassigned bucket no link', () => {
    const unassigned: DepotRow = {
      depot: depot('unassigned', { kind: 'unassigned', name: 'Unassigned' }),
      score: null,
    };
    act(() => root.render(<SelectionBar row={unassigned} />));
    expect(container.querySelector('a')).toBeNull();
  });
});

describe('unit terminology and the empty panel', () => {
  it('says "unit" where the selection can be any unit', () => {
    act(() => root.render(<Host initial={null} />));
    expect(container.querySelector('#depot-panel-heading')?.textContent).toBe('Selected unit');
    expect(container.textContent).toContain('Nothing selected. Pick a unit');
    expect(container.textContent).not.toMatch(/Selected depot|No depot selected/);
  });

  it('offers the lowest operating depot as a derived suggestion within its peer group', () => {
    act(() => root.render(<Host initial={null} />));
    const panel = container.querySelector('[data-testid="depot-map-panel"]');
    expect(panel?.textContent).toContain('Suggestion');
    expect(panel?.querySelector('[data-provenance="derived"]')?.textContent).toBe('DERIVED');
    expect(panel?.textContent).toContain('Lowest index among operating depots');
    expect(panel?.textContent).toContain('within its own peer group ranking');
    expect(panel?.textContent).toContain('Depot b');
  });
});

describe('ExceptionSummary', () => {
  const COUNTS: Record<ExceptionKind, number> = {
    emergency: 2,
    dark_share_high: 3,
    off_road_high: 0,
    on_road_low: 1,
    power_cut_cluster: 4,
    long_dark: 698,
    power_cut: 10,
    tamper_code: 5,
  };
  const SEVERITIES: Record<ExceptionSeverity, number> = { critical: 5, warning: 20, info: 15 };

  it('links every kind to the exceptions page filtered to it', () => {
    act(() => root.render(<ExceptionSummary counts={COUNTS} severities={SEVERITIES} />));
    const hrefs = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/project/depots/exceptions');
    expect(hrefs).toContain('/project/depots/exceptions?kind=long_dark');
    expect(hrefs).toContain('/project/depots/exceptions?kind=emergency');
    expect(hrefs.filter((href) => href?.includes('?kind='))).toHaveLength(8);
  });

  it('says once that depot exceptions are windowed and bus counts are as of the feed time', () => {
    const note = 'Depot exceptions compare rates over the last 20 minutes; bus counts are as of 14:20.';
    act(() =>
      root.render(<ExceptionSummary counts={COUNTS} severities={SEVERITIES} windowNote={note} />),
    );
    expect(container.querySelector('[data-testid="depot-exception-window"]')?.textContent).toBe(note);
  });

  it('names the scope of every total and links nothing but the exceptions page', () => {
    act(() => root.render(<ExceptionSummary counts={COUNTS} severities={SEVERITIES} />));
    expect(container.textContent).toMatch(/depot exceptions/);
    expect(container.textContent).toMatch(/bus exceptions/);
    const hrefs = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs.every((href) => href?.startsWith('/project/depots/exceptions'))).toBe(true);
  });
});
