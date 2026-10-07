import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NetworkServicePage } from '@/components/depot/service/NetworkServicePage';
import { appendAuditEvent } from '@/lib/audit/auditLog';
import { decisionEvent } from '@/lib/depot/rebalance/decisionEvents';
import { DECISION_STORAGE_KEY, serialiseSlice } from '@/lib/depot/rebalance/decisionStore';
import { bannedOnScreen } from './depot-guard-rendered';
import { networkHourlyFixture } from './depot-service-network-response';

/*
 * The Service page's daily brief and the decisions on its proposals: the brief is the
 * page's first section, a network kind with no route can be decided, and the trail lists
 * proposals only, never a transfer.
 */

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let container: HTMLDivElement;
let root: Root;
const response = networkHourlyFixture();

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

function render(): void {
  act(() => root.render(<NetworkServicePage response={response} error={null} loading={false} />));
}

function button(scope: ParentNode, text: string): HTMLButtonElement {
  const found = Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent === text,
  );
  if (!found) throw new Error(`no button ${text}`);
  return found;
}

function openRow(label: RegExp): HTMLElement {
  const table = container.querySelector('[data-testid="service-network-proposals"]');
  const row = Array.from(table?.querySelectorAll<HTMLElement>('tr[aria-expanded="false"]') ?? []).find(
    (r) => label.test(r.textContent ?? ''),
  );
  act(() => row?.click());
  const details = container.querySelectorAll<HTMLElement>('[data-testid="network-proposal-detail"]');
  const detail = details[details.length - 1];
  if (!detail) throw new Error('no opened row');
  return detail;
}

function trailLines(): string[] {
  return Array.from(container.querySelectorAll('[data-testid="proposal-trail"] li')).map(
    (li) => li.textContent ?? '',
  );
}

describe('the Service page', () => {
  it('opens with the daily brief, which requests nothing until pressed', () => {
    render();
    const page = container.querySelector('[data-testid="network-service-page"]');
    expect(page?.firstElementChild?.getAttribute('data-testid')).toBe('daily-brief');
  });

  it('records a decision on a depot reserve, which names no route', async () => {
    render();
    const detail = openRow(/Reserve/);
    await act(async () => button(detail, 'Approve').click());
    expect(button(detail, 'Approve').getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[data-testid="proposal-status"]')?.textContent).toBe(
      'Approved Alambagh 06:00–10:00, Reserve 2. Recorded only; nothing dispatched.',
    );
    expect(trailLines()[0]).toContain('Approved proposal: Alambagh 06:00–10:00, Reserve 2');
    expect(container.querySelector('[data-testid="daily-brief-decisions"]')?.textContent).toContain(
      '1 accepted, 0 declined',
    );
    expect(bannedOnScreen(container)).toEqual([]);
  });

  it('a corridor decision is said by its routes', async () => {
    render();
    const detail = openRow(/Corridor/);
    await act(async () => button(detail, 'Defer').click());
    expect(trailLines()[0]).toContain('Deferred proposal: KANPUR-LUCKNOW, LUCKNOW-KANPUR 06:00–10:00');
  });

  it('lists proposal decisions only, never a transfer', () => {
    const transfer = decisionEvent({
      transferId: 'agra>kanpur',
      fromDepotId: 'agra',
      fromDepotName: 'Agra',
      toDepotId: 'kanpur',
      toDepotName: 'Kanpur',
      buses: 5,
      operatingDate: response.operatingDate,
      scenario: null,
      scenarioLabel: null,
      note: '',
      decision: 'approved',
    });
    const events = appendAuditEvent([], transfer);
    window.localStorage.setItem(DECISION_STORAGE_KEY, serialiseSlice({ events, dropped: 0 }));
    render();
    expect(container.querySelector('[data-testid="proposal-trail"]')).not.toBeNull();
    expect(trailLines()).toHaveLength(0);
    expect(container.querySelector('[data-testid="daily-brief-decisions"]')).toBeNull();
  });
});
