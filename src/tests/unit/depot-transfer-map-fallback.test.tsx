import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TransferMap } from '@/components/depot/rebalance/TransferMap';

const MESSAGE = 'The basemap did not load. The transfer table below still works.';

// The hook talks to Google Maps; this test is about what the map shows when it fails.
vi.mock('@/components/depot/rebalance/useTransferMap', () => ({
  useTransferMap: () => ({
    containerRef: { current: null },
    mapRef: { current: null },
    nodesRef: { current: new Map() },
    arcsRef: { current: new Map() },
    status: 'error',
    message: MESSAGE,
  }),
}));

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let root: Root | null = null;
let container: HTMLElement;

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container.remove();
});

describe('transfer map when the basemap fails', () => {
  it('shows the flat shell panel with the hook message and a Retry button', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(
        <TransferMap geometry={{ nodes: [], arcs: [] }} selectedId={null} onSelect={() => {}} />,
      ),
    );
    const panel = container.querySelector('[data-testid="depot-map-unavailable"]');
    expect(panel?.textContent).toContain(MESSAGE);
    const retry = [...(panel?.querySelectorAll('button') ?? [])].find(
      (b) => b.textContent === 'Retry',
    );
    expect(retry).toBeDefined();
    // The command centre's glowing fallback is not used here.
    expect(container.querySelector('.hud-panel')).toBeNull();
  });
});
