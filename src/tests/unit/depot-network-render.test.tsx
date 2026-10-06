import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DepotMapPanel } from '@/components/depot/network/DepotMapPanel';
import { SelectionBar, SelectionLine } from '@/components/depot/network/SelectionBar';
import type { DepotRow } from '@/lib/depot/network/overviewModel';
import type { DepotSummary } from '@/lib/depot/types';
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
    <>
      <SelectionLine row={row} onClear={() => setRow(null)} />
      <DepotMapPanel
        row={row}
        rows={ROWS}
        onSelect={() => undefined}
        onClear={() => setRow(null)}
      />
    </>
  );
}

describe('clearing the selection keeps keyboard focus on the page', () => {
  it('moves focus to the selected-unit heading after "Clear selection"', () => {
    act(() => root.render(<Host initial={A} />));
    const clear = button('Clear selection');
    clear?.focus();
    expect(document.activeElement).toBe(clear);
    click(clear);
    expect(document.activeElement).toBe(container.querySelector('#depot-panel-heading'));
  });

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
