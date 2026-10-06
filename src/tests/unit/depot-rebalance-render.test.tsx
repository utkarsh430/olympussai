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

/** The first transfer's name: the keyboard way into its row (the row's click opens it). */
function rowOpener(): HTMLButtonElement {
  const found = container.querySelector<HTMLButtonElement>('tbody button[aria-expanded]');
  if (!found) throw new Error('no row opener');
  return found;
}

/** Approve sits in the transfer's expanded row: open it once, then press Approve. */
async function approve(): Promise<void> {
  if (rowOpener().getAttribute('aria-expanded') === 'false') {
    await act(async () => rowOpener().click());
  }
  await act(async () => button('Approve').click());
}

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  // "Why?" on the server plan asks for a rationale; these tests never reach a network.
  globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('offline')) as typeof fetch;
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
    await approve();
    const status = container.querySelector('[data-testid="rebalance-status"]');
    expect(status?.textContent).toBe(
      'Approved 5 buses Agra to Kanpur. Recorded only; nothing dispatched.',
    );
    expect(container.textContent).toContain('Approved for 5 buses');
    // Approve is a toggle: pressed for the recorded decision (capture round 5, item 12).
    expect(button('Approve').getAttribute('aria-pressed')).toBe('true');
    expect(button('Reject').getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('[data-testid="transfer-decision-word"]')?.textContent).toBe(
      'Approved',
    );
    await approve();
    const stored = JSON.parse(window.localStorage.getItem('depot-transfer-decisions-v1') ?? '{}');
    expect(stored.events).toHaveLength(1);
  });

  it('moves focus to the sandbox heading after a reset and says so', async () => {
    await render(<Distribution data={response()} state={{ error: null }} />);
    await typeInto('scenario-spare', '15');
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
    await approve();
    spy.mockRestore();
    expect(window.localStorage.getItem('upsrtc-copilot-audit-v1')).toBeNull();
    expect(window.localStorage.getItem('depot-transfer-decisions-v1')).toBeNull();
    const status = container.querySelector('[data-testid="rebalance-status"]');
    expect(status?.textContent).toContain('could not be recorded');
    expect(status?.textContent).toContain('no audit event exists');
  });

  it('writes the slice and the audit event together when storage accepts', async () => {
    await render(<Distribution data={response()} state={{ error: null }} />);
    await approve();
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
    await approve();
    await act(async () => button('Undo').click());
    const status = container.querySelector('[data-testid="rebalance-status"]');
    expect(status?.textContent).toBe(
      'Undid the approval of 5 buses Agra to Kanpur. Recorded only; nothing dispatched.',
    );
  });

  it('says so when the write of an undo is refused', async () => {
    await render(<Distribution data={response()} state={{ error: null }} />);
    await approve();
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    await act(async () => button('Undo').click());
    spy.mockRestore();
    const status = container.querySelector('[data-testid="rebalance-status"]');
    expect(status?.textContent).toContain('The undo could not be recorded');
  });
});

describe('transfer expanded row', () => {
  it('opens on a click anywhere on the row: rationale, figures and decision in one block', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('offline')) as typeof fetch;
    const props = { rows: [ROW], selectedId: null, onSelect: () => {}, onDecide: () => {} };
    await render(<TransferTable {...props} serverPlan />);
    expect(container.querySelector('[data-testid="transfer-detail-agra>kanpur"]')).toBeNull();
    const cell = container.querySelector<HTMLTableCellElement>('tbody tr td:nth-child(3)');
    await act(async () => cell?.click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const detail = container.querySelector('[data-testid="transfer-detail-agra>kanpur"] td');
    expect(detail?.getAttribute('colspan')).toBe('6');
    const block = detail?.querySelector('[data-testid="transfer-block"]');
    expect(block?.querySelector('[data-testid="rationale-panel"]')?.textContent).toContain(
      'Try again',
    );
    expect(block?.textContent).toContain(
      'Agra has 5 surplus buses before this transfer and 0 after; Kanpur is 5 buses short before and 0 after.',
    );
    expect(block?.querySelectorAll('button[aria-pressed]')).toHaveLength(3);
    expect(block?.querySelector('input')).not.toBeNull();
    expect(rowOpener().getAttribute('aria-expanded')).toBe('true');
  });

  it('has no boxed "Why?" on the row, only a muted chevron at its end', async () => {
    const props = { rows: [ROW], selectedId: null, onSelect: () => {}, onDecide: () => {} };
    await render(<TransferTable {...props} serverPlan />);
    const dataRow = container.querySelector('tbody tr');
    expect(dataRow?.textContent).not.toMatch(/Why\?/);
    expect(dataRow?.querySelectorAll('button')).toHaveLength(1);
    const last = dataRow?.querySelector('td:last-child');
    expect(last?.querySelector('[data-testid="depot-disclosure-chevron"]')).not.toBeNull();
  });

  it('opens the row a transfer picked on the map names', async () => {
    const props = { rows: [ROW], selectedId: 'agra>kanpur', onSelect: () => {}, onDecide: () => {} };
    await render(<TransferTable {...props} serverPlan={false} />);
    expect(container.querySelector('[data-testid="transfer-detail-agra>kanpur"]')).not.toBeNull();
  });

  it('offers Undo inside the same block when the row has a decision in force', async () => {
    const undo = vi.fn();
    const props = { rows: [ROW], selectedId: 'agra>kanpur', onSelect: () => {}, onDecide: () => {} };
    await render(<TransferTable {...props} undoFor={() => undo} serverPlan={false} />);
    const block = container.querySelector('[data-testid="transfer-block"]');
    const undoButton = [...(block?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'Undo');
    await act(async () => undoButton?.click());
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it('keeps Approve, Reject and Defer out of the data row: they are in the expanded row', async () => {
    const props = { rows: [ROW], selectedId: null, onSelect: () => {}, onDecide: () => {} };
    await render(<TransferTable {...props} serverPlan={false} />);
    const dataRow = container.querySelector('tbody tr');
    expect(dataRow?.querySelectorAll('td')).toHaveLength(6);
    expect(dataRow?.textContent).not.toMatch(/Approve|Reject|Defer/);
    expect(dataRow?.querySelector('input')).toBeNull();
  });

  it('opens figures and the decision under a what-if, with no rationale, and says why once', async () => {
    const props = { rows: [ROW], selectedId: null, onSelect: () => {}, onDecide: () => {} };
    await render(<TransferTable {...props} serverPlan={false} />);
    const said = 'A written rationale is available for the server plan only.';
    expect(container.textContent?.split(said)).toHaveLength(2);
    await act(async () => rowOpener().click());
    const detail = container.querySelector('[data-testid="transfer-detail-agra>kanpur"] td');
    expect(detail?.textContent).toContain('Agra has 5 surplus buses before this transfer');
    expect(detail?.textContent).not.toContain('Try again');
    expect(detail?.querySelectorAll('button[aria-pressed]')).toHaveLength(3);
    expect(container.textContent?.split(said)).toHaveLength(2);
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
  it('offers no reset while the server plan shows', async () => {
    await render(<Distribution data={response()} state={{ error: null }} />);
    expect(resetButtons()).toHaveLength(0);
    expect(container.querySelector('[data-testid="rebalance-whatif-strip"]')).toBeNull();
  });

  it('says a what-if shows in one line, with the one reset, worded "Reset to the server plan"', async () => {
    await render(<Distribution data={response()} state={{ error: null }} />);
    await typeInto('scenario-spare', '15');
    const strip = container.querySelector('[data-testid="rebalance-whatif-strip"]');
    expect(strip?.querySelectorAll('button')).toHaveLength(1);
    expect(resetButtons().map(accessibleName)).toEqual(['Reset to the server plan']);
    const sentences = container.querySelectorAll('[data-testid="rebalance-whatif-sentence"]');
    expect(sentences).toHaveLength(1);
    expect(strip?.contains(sentences[0] ?? null)).toBe(true);
    expect(sentences[0]?.textContent).toMatch(/^Showing a what-if, not the server plan: /);
    expect(sentences[0]?.getAttribute('title')).toBe(sentences[0]?.textContent);
  });

  it('shows every field with the value in force and its unit, before and after a reset', async () => {
    await render(<Distribution data={response()} state={{ error: null }} />);
    const field = (id: string) => container.querySelector<HTMLInputElement>(`#${id}`);
    const unitOf = (id: string) => field(id)?.nextElementSibling?.textContent;
    expect(field('scenario-spare')?.value).toBe('8');
    expect(unitOf('scenario-spare')).toBe('%');
    expect(field('scenario-distance')?.value).toBe('250');
    expect(unitOf('scenario-distance')).toBe('km');
    await typeInto('scenario-spare', '15');
    await act(async () => button('Reset to the server plan').click());
    expect(field('scenario-spare')?.value).toBe('8');
    expect(field('scenario-distance')?.value).toBe('250');
    expect(container.querySelector('[data-testid="rebalance-whatif-strip"]')).toBeNull();
    expect(resetButtons()).toHaveLength(0);
  });

  it('shows no what-if when a field is put back to the value in force', async () => {
    await render(<Distribution data={response()} state={{ error: null }} />);
    await typeInto('scenario-distance', '250');
    expect(container.querySelector('[data-testid="rebalance-whatif-strip"]')).toBeNull();
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

describe('provenance tags on the visible page (ruling S51)', () => {
  it('tags the generated before-and-after band once, on its label line, and no figure (R2-m17)', async () => {
    await render(<Distribution data={response()} state={{ error: null }} />);
    const band = container.querySelector('[data-testid="rebalance-summary"]');
    const figures = band?.querySelectorAll('li') ?? [];
    expect(figures).toHaveLength(5);
    const tags = band?.querySelectorAll('[data-provenance="modelled"]') ?? [];
    expect(tags).toHaveLength(1);
    for (const figure of figures) expect(figure.querySelector('[data-provenance]')).toBeNull();
  });

  it('tags the generated columns of the every-depot table in their header cells only', async () => {
    await render(<Distribution data={response()} state={{ error: null }} />);
    const toggle = container.querySelector<HTMLButtonElement>('#rebalance-balance-heading button');
    await act(async () => toggle?.click());
    const table = container.querySelector('[data-testid="rebalance-balances"] table');
    const headers = [...(table?.querySelectorAll('thead th') ?? [])];
    const tagged = headers
      .filter((th) => th.querySelector('[data-provenance="modelled"]'))
      .map((th) => th.textContent?.replace(/modelled/i, '').trim());
    expect(tagged).toEqual(['Peak need', 'Spare', 'Required', 'Balance']);
    const plain = headers.filter((th) => !th.querySelector('[data-provenance]'));
    expect(plain.map((th) => th.textContent)).toEqual(['Depot', 'Fleet', 'Off road', 'Available']);
    expect(table?.querySelector('tbody [data-provenance]')).toBeNull();
  });

  it('tags the recommended transfers section label MODELLED', async () => {
    await render(<Distribution data={response()} state={{ error: null }} />);
    const heading = container.querySelector('#rebalance-map-heading');
    expect(heading?.textContent).toMatch(/^Recommended transfers/);
    const label = heading?.closest('[data-testid="depot-section-label"]');
    expect(label?.querySelector('[data-provenance="modelled"]')).not.toBeNull();
  });
});

describe('shortfall the plan cannot cover', () => {
  it('is one compact line with its square when every shortfall is covered', async () => {
    await render(<Distribution data={response()} state={{ error: null }} />);
    const line = container.querySelector('[data-testid="rebalance-covered"]');
    expect(line?.textContent).toContain('Every modelled shortfall is covered');
    expect(line?.querySelector('[data-testid="depot-state-square"]')).not.toBeNull();
    expect(container.textContent).not.toMatch(/shortfall the plan cannot cover/i);
  });

  it('is a full list only when there is something to list', async () => {
    const data = response();
    const plan = {
      ...data.plan,
      uncovered: [{ depotId: 'kanpur', buses: 2, reason: 'insufficient_surplus' }],
    };
    await render(<Distribution data={{ ...data, plan } as typeof data} state={{ error: null }} />);
    const section = container.querySelector('[data-testid="rebalance-uncovered"]');
    expect(section?.textContent).toMatch(/shortfall the plan cannot cover/i);
    expect(section?.querySelectorAll('li')).toHaveLength(1);
    expect(container.querySelector('[data-testid="rebalance-covered"]')).toBeNull();
  });
});

describe('decision trail', () => {
  it('is one line and the append-only note while empty, with no group headings', async () => {
    await render(<Distribution data={response()} state={{ error: null }} />);
    const trail = container.querySelector('[data-testid="rebalance-trail"]');
    expect(trail?.querySelector('h2')?.textContent).toBe(
      'Decision trail · 6 Oct 2026: none recorded in this browser',
    );
    expect(trail?.querySelector('h3')).toBeNull();
    expect(trail?.querySelector('ol')).toBeNull();
    const note = trail?.querySelector('[data-testid="rebalance-trail-note"]');
    expect(note?.className).toContain('depot-note');
    expect(note?.textContent).toMatch(/append-only/);
    expect(note?.textContent).toMatch(/kept in this browser only.*no transfer order is issued/);
  });

  it('expands to the group with entries once a decision is recorded', async () => {
    await render(<Distribution data={response()} state={{ error: null }} />);
    await approve();
    const trail = container.querySelector('[data-testid="rebalance-trail"]');
    expect(trail?.querySelector('h2')?.textContent).toBe('Decision trail · 6 Oct 2026');
    expect([...(trail?.querySelectorAll('h3') ?? [])].map((h) => h.textContent)).toEqual([
      'On the modelled plan',
    ]);
    expect(trail?.querySelector('[data-testid="rebalance-trail-note"]')).not.toBeNull();
  });
});

describe('transfer plan split', () => {
  it('puts the table in 55% and the map in 45% at xl, the table first below xl', async () => {
    await render(<Distribution data={response()} state={{ error: null }} />);
    const table = container.querySelector('[data-testid="rebalance-transfers"]');
    const grid = table?.closest('[class*="xl:grid-cols"]');
    expect(grid?.className).toContain('xl:grid-cols-[minmax(0,45fr)_minmax(0,55fr)]');
    const tableColumn = [...(grid?.children ?? [])].find((c) => c.contains(table ?? null));
    expect(tableColumn?.className).toContain('order-1');
    expect(tableColumn?.className).toContain('xl:order-2');
  });
});

describe('transfer table preview', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ ...ROW, id: `t${i}` }));
  const props = { selectedId: null, onSelect: () => {}, onDecide: () => {} };

  it('shows ten transfers and a "Show all" control that reveals the rest', async () => {
    await render(<TransferTable rows={many} {...props} serverPlan={false} />);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(10);
    await act(async () => button('Show all 12›').click());
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

describe('dates on the fleet distribution page', () => {
  it('never puts an ISO date in its text or attributes, with a decision recorded', async () => {
    await render(<Distribution data={response()} state={{ error: null }} />);
    await approve();
    const iso = /\d{4}-\d{2}-\d{2}/;
    expect(container.textContent).not.toMatch(iso);
    for (const el of container.querySelectorAll('*')) {
      for (const attr of el.getAttributeNames()) {
        if (attr === 'data-testid' || attr === 'id') continue;
        expect(`${attr}=${el.getAttribute(attr)}`).not.toMatch(iso);
      }
    }
  });
});
