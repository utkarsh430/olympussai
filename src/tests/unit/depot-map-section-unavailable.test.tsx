import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MapSection } from '@/components/depot/network/MapSection';
import type { DepotMapStatus } from '@/components/depot/network/useDepotMap';
import type { DepotRow } from '@/lib/depot/network/overviewModel';
import type { DepotSummary } from '@/lib/depot/types';

let reported: DepotMapStatus = 'ready';

// The real map needs Google Maps; this stub only reports the status the test sets.
vi.mock('@/components/depot/network/DepotMap', () => ({
  DepotMap: ({
    onStatusChange,
  }: {
    onStatusChange?: (status: DepotMapStatus) => void;
  }): React.ReactElement => {
    useEffect(() => onStatusChange?.(reported), [onStatusChange]);
    return <div data-testid="depot-map" />;
  },
}));

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let container: HTMLDivElement;
let root: Root;

const DEPOT: DepotSummary = {
  id: 'a',
  name: 'Depot a',
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
};
const ROWS: readonly DepotRow[] = [{ depot: DEPOT, score: null }];

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

async function render(): Promise<void> {
  await act(async () =>
    root.render(<MapSection rows={ROWS} selected={null} onSelect={() => {}} vanished={false} />),
  );
}

describe('overview map section', () => {
  it('shows the caption, the explanation and the legend while the map works', async () => {
    reported = 'ready';
    await render();
    expect(container.querySelector('[data-testid="depot-map-unpositioned"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="depot-map-legend"]')).not.toBeNull();
    expect(container.textContent).toContain('median position of its buses');
  });

  it('drops the caption, the explanation and the legend when the map is unavailable', async () => {
    reported = 'error';
    await render();
    expect(container.querySelector('[data-testid="depot-map-unpositioned"]')).toBeNull();
    expect(container.querySelector('[data-testid="depot-map-legend"]')).toBeNull();
    expect(container.textContent).not.toContain('Every unit has at least one positioned bus');
    expect(container.textContent).not.toContain('median position of its buses');
    expect(container.querySelector('[data-testid="depot-map"]')).not.toBeNull();
  });
});
