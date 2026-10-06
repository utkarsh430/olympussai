import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Distribution, RESET_ANNOUNCEMENT } from '@/components/depot/rebalance/RebalancePage';
import { TransferTable } from '@/components/depot/rebalance/TransferTable';
import type { DepotDistributionResponse } from '@/lib/depot/api';
import type { DepotBalance, TransferPlan } from '@/lib/depot/optimise/types';
import type { TransferRow } from '@/lib/depot/rebalance/transferModel';

// The map needs Google Maps; these tests are about the table, the sandbox and the status line.
vi.mock('@/components/depot/rebalance/TransferMap', () => ({ TransferMap: () => null }));

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let root: Root | null = null;
let container: HTMLElement;
const originalFetch = globalThis.fetch;

function balance(depotId: string, depotName: string, value: number): DepotBalance {
  return {
    depotId,
    depotName,
    kind: 'depot',
    position: null,
    fleet: 20,
    offRoad: 0,
    available: 20,
    peakRequirement: 20 - value,
    spareTarget: 0,
    required: 20 - value,
    balance: value,
  } as DepotBalance;
}

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

function response(): DepotDistributionResponse {
  const plan = {
    transfers: [
      {
        id: ROW.id,
        fromDepotId: 'agra',
        toDepotId: 'kanpur',
        buses: 5,
        distanceKm: 120,
        busKm: 600,
      },
    ],
    uncovered: [],
    before: { totalSurplus: 5, totalDeficit: 5 },
    after: { totalSurplus: 0, totalDeficit: 0 },
    coveredDeficit: 5,
    totalBusKm: 600,
  } as unknown as TransferPlan;
  return {
    operatingDate: '2026-10-06',
    feedNow: '2026-10-06T08:00:00Z',
    stale: false,
    source: 'live',
    balances: [balance('agra', 'Agra', 5), balance('kanpur', 'Kanpur', -5)],
    plan,
    requirementParams: { spareRatio: 0.08 },
    rebalanceParams: { maxTransferKm: 250 },
  } as unknown as DepotDistributionResponse;
}

async function render(element: React.ReactElement): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(element));
}

function button(name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((b) => b.textContent === name);
  if (!found) throw new Error(`no button ${name}`);
  return found;
}

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container.remove();
  globalThis.fetch = originalFetch;
});

describe('fleet distribution page', () => {
  it('announces a decision politely and ignores a repeat click', async () => {
    await render(<Distribution data={response()} state={{ error: null }} />);
    await act(async () => button('Approve').click());
    const status = container.querySelector('[data-testid="rebalance-notice"] [role="status"]');
    expect(status?.textContent).toBe(
      'Approved 5 buses Agra to Kanpur. Recorded only; nothing dispatched.',
    );
    expect(container.textContent).toContain('Approved for 5 buses');
    await act(async () => button('Approve').click());
    const stored = JSON.parse(window.localStorage.getItem('depot-transfer-decisions-v1') ?? '{}');
    expect(stored.events).toHaveLength(1);
  });

  it('moves focus to the sandbox heading after a reset and says so', async () => {
    await render(<Distribution data={response()} state={{ error: null }} />);
    await act(async () => button('Reset to the server plan').click());
    expect(document.activeElement?.id).toBe('rebalance-sandbox-heading');
    expect(container.textContent).toContain(RESET_ANNOUNCEMENT);
  });
});

describe('transfer rationale row', () => {
  it('opens a full-width detail row that shows its own error when the request fails', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('offline')) as typeof fetch;
    const props = { rows: [ROW], selectedId: null, onSelect: () => {}, onDecide: () => {} };
    await render(<TransferTable {...props} serverPlan />);
    expect(container.querySelector('[data-testid="transfer-detail-agra>kanpur"]')).toBeNull();
    const toggle = container.querySelector<HTMLButtonElement>('button[aria-expanded]');
    await act(async () => toggle?.click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const detail = container.querySelector('[data-testid="transfer-detail-agra>kanpur"] td');
    expect(detail?.getAttribute('colspan')).toBe('8');
    expect(detail?.textContent).toContain('Try again');
  });

  it('offers no rationale under a what-if and says why once', async () => {
    const props = { rows: [ROW], selectedId: null, onSelect: () => {}, onDecide: () => {} };
    await render(<TransferTable {...props} serverPlan={false} />);
    expect(container.querySelector('button[aria-expanded]')).toBeNull();
    expect(container.textContent).toContain(
      'A written rationale is available for the server plan only.',
    );
  });
});
