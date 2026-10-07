import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendAuditEvent, type AuditEvent } from '@/lib/audit/auditLog';
import { decisionEvent } from '@/lib/depot/rebalance/decisionEvents';
import { DECISION_STORAGE_KEY, serialiseSlice } from '@/lib/depot/rebalance/decisionStore';
import { proposalDecisionEvent } from '@/lib/depot/rebalance/proposalDecisionEvents';
import { ProposalsTable } from '@/components/depot/service/ProposalsTable';
import { RouteHourlyPage } from '@/components/depot/service/RouteHourlyPage';
import { bannedOnScreen } from './depot-guard-rendered';
import { routeHourlyFixture } from './depot-service-fixtures';

// The chart is under test elsewhere; here only the proposals' place on the page matters.
vi.mock('@/components/depot/hourChart/HourChart', () => ({ HourChart: () => null }));

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let container: HTMLDivElement;
let root: Root;
const day = routeHourlyFixture();

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.localStorage.clear();
});

function renderTable(trailRoute: string | null = day.routeName): void {
  act(() =>
    root.render(
      <ProposalsTable
        proposals={day.proposals}
        hours={day.hours}
        operatingDate={day.operatingDate}
        trailRoute={trailRoute}
      />,
    ),
  );
}

function openFirstRow(): HTMLElement {
  const row = container.querySelector<HTMLElement>('tr[aria-expanded="false"]');
  act(() => row?.click());
  const detail = container.querySelector<HTMLElement>('[data-testid="proposal-detail"]');
  if (!detail) throw new Error('no opened row');
  return detail;
}

function button(scope: ParentNode, text: string): HTMLButtonElement {
  const found = Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent === text,
  );
  if (!found) throw new Error(`no button ${text}`);
  return found;
}

async function typeNote(scope: ParentNode, text: string): Promise<void> {
  const input = scope.querySelector<HTMLInputElement>('input[type="text"]');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(input, text);
    input?.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function trailLines(): string[] {
  return Array.from(container.querySelectorAll('[data-testid="proposal-trail"] li')).map(
    (li) => li.textContent ?? '',
  );
}

function seed(events: readonly AuditEvent[]): void {
  window.localStorage.setItem(DECISION_STORAGE_KEY, serialiseSlice({ events, dropped: 0 }));
}

describe('decisions on a proposal', () => {
  it('offers Approve, Defer and Reject with a note in the opened row, none pressed', () => {
    renderTable();
    const detail = openFirstRow();
    const controls = detail.querySelector('[data-testid="proposal-decision"]');
    expect(controls?.textContent).toContain('None yet');
    expect(controls?.textContent).toContain('Recorded only; nothing dispatched.');
    for (const label of ['Approve', 'Defer', 'Reject']) {
      expect(button(controls!, label).getAttribute('aria-pressed')).toBe('false');
    }
    expect(controls?.querySelector('input[type="text"]')).not.toBeNull();
  });

  it('records a decision in this browser only, says so, and lists it with its note', async () => {
    renderTable();
    const detail = openFirstRow();
    await typeNote(detail, 'Morning peak');
    await act(async () => button(detail, 'Approve').click());
    expect(button(detail, 'Approve').getAttribute('aria-pressed')).toBe('true');
    const status = container.querySelector('[data-testid="proposal-status"]');
    expect(status?.getAttribute('role')).toBe('status');
    expect(status?.textContent).toMatch(/^Approved KANPUR-LUCKNOW .*Recorded only; nothing dispatched\.$/);
    const [line] = trailLines();
    expect(line).toContain('Approved proposal: KANPUR-LUCKNOW');
    expect(line).toContain('Note: Morning peak');
    const stored = JSON.parse(window.localStorage.getItem(DECISION_STORAGE_KEY) ?? '{}');
    expect(stored.events).toHaveLength(1);
    const audit = JSON.parse(window.localStorage.getItem('upsrtc-copilot-audit-v1') ?? '[]');
    expect(JSON.parse(audit[0].detail).note).toBe('');
    expect(bannedOnScreen(container)).toEqual([]);
  });

  it('a second click on the decision in force records nothing; Undo adds an entry', async () => {
    renderTable();
    const detail = openFirstRow();
    await act(async () => button(detail, 'Defer').click());
    await act(async () => button(detail, 'Defer').click());
    expect(trailLines()).toHaveLength(1);
    await act(async () => button(detail, 'Undo').click());
    expect(trailLines()).toHaveLength(2);
    expect(trailLines()[0]).toContain('Undid deferred proposal');
    expect(button(detail, 'Defer').getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('[data-testid="proposal-status"]')?.textContent).toContain(
      'Undid the deferral of',
    );
  });

  it('clears the whole trail only after the confirm step', async () => {
    renderTable();
    const detail = openFirstRow();
    await act(async () => button(detail, 'Reject').click());
    await act(async () => button(container, 'Clear trail').click());
    expect(trailLines()).toHaveLength(1);
    await act(async () => button(container, 'Clear the trail').click());
    expect(trailLines()).toHaveLength(0);
    expect(window.localStorage.getItem(DECISION_STORAGE_KEY)).toBeNull();
  });

  it('says in every state that the trail is kept in this browser and moves no bus', () => {
    renderTable();
    const trail = container.querySelector('[data-testid="proposal-trail"]');
    expect(trail?.querySelector('h3')?.textContent).toBe(
      'Decision trail · 6 Oct 2026: none recorded in this browser',
    );
    expect(trail?.textContent).toContain('kept in this browser only');
    expect(trail?.textContent).toContain('no bus is added, held or moved');
  });
});

describe('the trail shows the subject the page is about', () => {
  const other = proposalDecisionEvent({
    subject: {
      kind: 'proposal',
      proposalId: 'other',
      routeName: 'AGRA-DELHI',
      proposalKind: 'add_buses',
      band: { fromHour: 16, toHour: 18 },
      change: 2,
      routes: [],
      depotName: null,
      count: null,
    },
    operatingDate: day.operatingDate,
    note: '',
    decision: 'approved',
  });
  const transfer = decisionEvent({
    transferId: 'agra>kanpur',
    fromDepotId: 'agra',
    fromDepotName: 'Agra',
    toDepotId: 'kanpur',
    toDepotName: 'Kanpur',
    buses: 5,
    operatingDate: day.operatingDate,
    scenario: null,
    scenarioLabel: null,
    note: '',
    decision: 'approved',
  });
  const events = appendAuditEvent(appendAuditEvent([], transfer), other);

  it("the route day lists that route's proposals only, never a transfer", () => {
    seed(events);
    act(() => root.render(<RouteHourlyPage response={day} error={null} loading={false} />));
    expect(container.querySelector('[data-testid="proposal-trail"]')).not.toBeNull();
    expect(trailLines()).toHaveLength(0);
  });

  it('with no route named, every route proposal is listed, never a transfer', () => {
    seed(events);
    renderTable(null);
    expect(trailLines()).toHaveLength(1);
    expect(trailLines()[0]).toContain('AGRA-DELHI 16:00–19:00, Add 2');
  });
});

describe("a proposal row's explanation", () => {
  it('has exactly one Why? button in each opened row', () => {
    renderTable();
    const rows = Array.from(container.querySelectorAll<HTMLElement>('tr[aria-expanded="false"]'));
    act(() => rows.forEach((r) => r.click()));
    const details = container.querySelectorAll('[data-testid="proposal-detail"]');
    expect(details.length).toBe(rows.length);
    for (const detail of Array.from(details)) {
      expect(detail.querySelectorAll('button[aria-label^="Why?"]')).toHaveLength(1);
    }
  });
});
