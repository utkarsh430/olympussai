import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Distribution, RESET_ANNOUNCEMENT } from '@/components/depot/rebalance/RebalancePage';
import { DecisionTrail } from '@/components/depot/rebalance/DecisionTrail';
import type { TrailItem } from '@/lib/depot/rebalance/decisionEvents';
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
    const status = container.querySelector('[data-testid="rebalance-status"]');
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

describe('write order', () => {
  it('writes no audit event and says so when storage refuses the decision slice', async () => {
    await render(<Distribution data={response()} state={{ error: null }} />);
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    await act(async () => button('Approve').click());
    spy.mockRestore();
    expect(window.localStorage.getItem('upsrtc-copilot-audit-v1')).toBeNull();
    expect(window.localStorage.getItem('depot-transfer-decisions-v1')).toBeNull();
    const status = container.querySelector('[data-testid="rebalance-status"]');
    expect(status?.textContent).toContain('could not be recorded');
    expect(status?.textContent).toContain('no audit event exists');
  });

  it('writes the slice and the audit event together when storage accepts', async () => {
    await render(<Distribution data={response()} state={{ error: null }} />);
    await act(async () => button('Approve').click());
    expect(window.localStorage.getItem('upsrtc-copilot-audit-v1')).not.toBeNull();
    expect(window.localStorage.getItem('depot-transfer-decisions-v1')).not.toBeNull();
  });
});

describe('decision trail keys', () => {
  it('renders entries that share an id without a duplicate-key warning', async () => {
    const item: TrailItem = {
      eventId: 'same',
      at: '2026-10-06T08:00:00Z',
      transferId: ROW.id,
      fromDepotId: 'agra',
      fromDepotName: 'Agra',
      toDepotId: 'kanpur',
      toDepotName: 'Kanpur',
      buses: 5,
      operatingDate: '2026-10-06',
      scenario: null,
      scenarioLabel: null,
      note: '',
      decision: 'approved',
      undoes: null,
      undoable: false,
      undone: false,
      superseded: false,
    };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await render(
      <DecisionTrail
        trail={{ baseline: [item, item, item], scenario: [] }}
        operatingDate="2026-10-06"
        onUndo={() => {}}
        capacityNote={null}
      />,
    );
    const warned = errors.mock.calls.some((call) => String(call[0]).includes('same key'));
    errors.mockRestore();
    expect(warned).toBe(false);
    expect(container.querySelectorAll('[data-testid="rebalance-trail"] li')).toHaveLength(3);
  });
});

describe('undo announcement', () => {
  it('announces an undo in the same status line', async () => {
    await render(<Distribution data={response()} state={{ error: null }} />);
    await act(async () => button('Approve').click());
    await act(async () => button('Undo').click());
    const status = container.querySelector('[data-testid="rebalance-status"]');
    expect(status?.textContent).toBe(
      'Undid the approval of 5 buses Agra to Kanpur. Recorded only; nothing dispatched.',
    );
  });

  it('says so when the write of an undo is refused', async () => {
    await render(<Distribution data={response()} state={{ error: null }} />);
    await act(async () => button('Approve').click());
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    await act(async () => button('Undo').click());
    spy.mockRestore();
    const status = container.querySelector('[data-testid="rebalance-status"]');
    expect(status?.textContent).toContain('The undo could not be recorded');
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
    expect(detail?.getAttribute('colspan')).toBe('9');
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

function resetButtons(): HTMLButtonElement[] {
  return [...container.querySelectorAll('button')].filter((b) =>
    (b.getAttribute('aria-label') ?? b.textContent ?? '').startsWith('Reset to the server plan'),
  );
}

function accessibleName(b: HTMLElement): string {
  return b.getAttribute('aria-label') ?? b.textContent ?? '';
}

async function typeInto(id: string, text: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>(`#${id}`);
  if (!input) throw new Error(`no field ${id}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
}

describe('reset to the server plan', () => {
  it('offers one reset while no what-if shows, in the sandbox', async () => {
    await render(<Distribution data={response()} state={{ error: null }} />);
    expect(resetButtons()).toHaveLength(1);
    expect(container.querySelector('[data-testid="rebalance-whatif-strip"] button')).toBeNull();
  });

  it('adds one in the what-if strip while a what-if shows, with a distinct accessible name', async () => {
    await render(<Distribution data={response()} state={{ error: null }} />);
    await typeInto('scenario-spare', '15');
    const inStrip = container.querySelectorAll('[data-testid="rebalance-whatif-strip"] button');
    expect(inStrip).toHaveLength(1);
    const names = resetButtons().map(accessibleName);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
  });

  it('shows each field empty with its default as the placeholder, and no strip reset', async () => {
    await render(<Distribution data={response()} state={{ error: null }} />);
    await typeInto('scenario-spare', '15');
    const inStrip = container.querySelector('[data-testid="rebalance-whatif-strip"] button');
    await act(async () => (inStrip as HTMLButtonElement).click());
    const spare = container.querySelector<HTMLInputElement>('#scenario-spare');
    const distance = container.querySelector<HTMLInputElement>('#scenario-distance');
    expect(spare?.value).toBe('');
    expect(spare?.placeholder).toBe('8 (default)');
    expect(distance?.placeholder).toBe('250 (default)');
    expect(container.querySelector('[data-testid="rebalance-whatif-strip"] button')).toBeNull();
    expect(container.querySelector('[data-testid="rebalance-whatif-sentence"]')).toBeNull();
    expect(resetButtons()).toHaveLength(1);
  });
});

describe('page layout', () => {
  it('has one notice in the flow, never sticky, and no what-if strip on the server plan', async () => {
    await render(<Distribution data={response()} state={{ error: null }} />);
    const notices = container.querySelectorAll('[data-testid="depot-notice"]');
    expect(notices).toHaveLength(1);
    expect(notices[0]?.className).not.toMatch(/sticky/);
    expect(notices[0]?.textContent).toMatch(/nothing is dispatched or reassigned/i);
    expect(container.querySelector('[data-testid="rebalance-whatif-strip"]')).toBeNull();
  });

  it('tags the transfer section, not its columns, and keeps sandbox and depot table closed', async () => {
    await render(<Distribution data={response()} state={{ error: null }} />);
    const label = container.querySelector('#rebalance-map-heading')?.parentElement;
    expect(label?.textContent).toMatch(/modelled/i);
    const sandbox = container.querySelector('#rebalance-sandbox-heading button');
    const balances = container.querySelector('#rebalance-balance-heading button');
    expect(sandbox?.getAttribute('aria-expanded')).toBe('false');
    expect(balances?.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('transfer table preview', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ ...ROW, id: `t${i}` }));
  const props = { selectedId: null, onSelect: () => {}, onDecide: () => {} };

  it('shows ten transfers and a "Show all" control that reveals the rest', async () => {
    await render(<TransferTable rows={many} {...props} serverPlan={false} />);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(10);
    await act(async () => button('Show all 12 transfers').click());
    expect(container.querySelectorAll('tbody tr')).toHaveLength(12);
  });

  it('says in a title when the two depots stand at the same place', async () => {
    const near = { ...ROW, fromName: 'Meerut', toName: 'Bhaisali', distanceKm: 0.2 };
    await render(<TransferTable rows={[near]} {...props} serverPlan={false} />);
    expect(container.querySelector('tbody tr')?.getAttribute('title')).toBe(
      'Meerut and Bhaisali stand at the same place by their inferred positions (0.2 km apart).',
    );
  });
});
