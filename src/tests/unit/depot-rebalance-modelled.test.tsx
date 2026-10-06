import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MapHoverCard } from '@/components/depot/rebalance/MapHoverCard';
import { ScenarioCompare } from '@/components/depot/rebalance/ScenarioCompare';
import { TransferMapLegend } from '@/components/depot/rebalance/TransferMapLegend';
import { TransferTable } from '@/components/depot/rebalance/TransferTable';
import type { ScenarioDelta } from '@/lib/depot/optimise/types';
import type { MapGeometry } from '@/lib/depot/rebalance/mapGeometry';
import type { PlanSummary } from '@/lib/depot/rebalance/rebalanceModel';
import type { TransferRow } from '@/lib/depot/rebalance/transferModel';

/*
 * Generated figures must say MODELLED where they are shown. These tests pin
 * the words, so a regression cannot pass the type checker and the linter.
 */

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let root: Root | null = null;
let container: HTMLElement;

const ROW: TransferRow = {
  id: 'agra>kanpur',
  fromDepotId: 'agra',
  fromName: 'Agra',
  toDepotId: 'kanpur',
  toName: 'Kanpur',
  buses: 5,
  distanceKm: 120,
  busKm: 600,
  giverSurplusBefore: 5,
  receiverDeficitBefore: 5,
  decision: null,
};

const DELTA: ScenarioDelta = {
  transfers: 0,
  busesMoved: 0,
  totalBusKm: 0,
  coveredDeficit: 0,
  uncoveredDeficit: 0,
  depotsInDeficitAfter: 0,
};

const SUMMARY = {
  before: { totalSurplus: 5, totalDeficit: 5 },
  after: { totalSurplus: 0, totalDeficit: 0 },
  transfers: 1,
  busesMoved: 5,
  coveredDeficit: 5,
  uncoveredDeficit: 0,
  busKm: 600,
} as unknown as PlanSummary;

const GEOMETRY: MapGeometry = {
  nodes: [
    {
      depotId: 'agra',
      depotName: 'Agra',
      position: { lat: 27.1, lng: 78 },
      balance: 5,
      cls: 'surplus',
    },
    {
      depotId: 'kanpur',
      depotName: 'Kanpur',
      position: { lat: 26.4, lng: 80.3 },
      balance: -5,
      cls: 'deficit',
    },
  ],
  arcs: [
    {
      transferId: ROW.id,
      fromDepotId: 'agra',
      toDepotId: 'kanpur',
      from: { lat: 27.1, lng: 78 },
      to: { lat: 26.4, lng: 80.3 },
      buses: 5,
      widthPx: 4,
    },
  ],
} as unknown as MapGeometry;

async function render(element: React.ReactElement): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(element));
}

function texts(selector: string): string[] {
  return [...container.querySelectorAll(selector)].map((e) => e.textContent ?? '');
}

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container.remove();
});

describe('MODELLED wording', () => {
  it('is on the transfer table caption, and the figure headers leave it to the section label', async () => {
    await render(
      <TransferTable
        rows={[ROW]}
        selectedId={null}
        onSelect={() => {}}
        onDecide={() => {}}
        serverPlan
      />,
    );
    expect(container.querySelector('caption')?.textContent).toMatch(/modelled/i);
    const headers = texts('thead th');
    const figures = headers.filter((h) => /buses|km|spare|short/i.test(h));
    expect(figures).toEqual(['Buses', 'Road km', 'Bus-km']);
    for (const header of figures) expect(header).not.toMatch(/modelled/i);
  });

  it('is on the comparison section heading once, not repeated in its columns', async () => {
    await render(<ScenarioCompare delta={DELTA} baseline={SUMMARY} scenario={SUMMARY} />);
    const heading = container.querySelector('#rebalance-compare-heading')?.parentElement;
    expect(heading?.querySelector('[data-provenance="modelled"]')).not.toBeNull();
    const headers = texts('thead th');
    expect(headers.slice(1, 3)).toEqual(['Server plan', 'What-if']);
    expect(container.querySelector('caption')?.textContent).toMatch(/modelled/i);
  });

  it('is on no legend entry and no legend label: the transfers section carries the tag', async () => {
    await render(<TransferMapLegend maxBuses={10} />);
    const entries = texts('[data-testid="rebalance-map-legend"] > div:first-child li');
    expect(entries).toEqual(['Spare buses', 'Short of buses', 'Balanced']);
    const legend = container.querySelector('[data-testid="rebalance-map-legend"]');
    expect(legend?.textContent).not.toMatch(/modelled/i);
    expect(legend?.querySelector('p')).toBeNull();
    expect(texts('[data-testid="rebalance-map-legend"] > div:last-child li')).toEqual([
      '10 buses',
      '3 buses',
      '1 bus',
    ]);
  });

  it('is on the hover card for a depot and for a transfer', async () => {
    await render(<MapHoverCard hover="node:agra" geometry={GEOMETRY} />);
    expect(container.textContent).toMatch(/modelled/i);
    await act(async () =>
      root?.render(<MapHoverCard hover={`arc:${ROW.id}`} geometry={GEOMETRY} />),
    );
    expect(container.textContent).toContain('Agra → Kanpur');
    expect(container.textContent).toMatch(/modelled/i);
  });
});
