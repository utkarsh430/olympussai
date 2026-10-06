import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DutyBoard } from '@/components/depot/duties/DutyBoard';
import type { BoardDuty } from '@/lib/depot/duties/api';
import { buildBoardRows } from '@/lib/depot/duties/dutyBoardModel';

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
const originalActFlag = actGlobal.IS_REACT_ACT_ENVIRONMENT;

const DUTIES: readonly BoardDuty[] = [
  {
    id: 'D-0',
    routeName: 'ORD_1',
    startMin: 360,
    endMin: 900,
    serviceClass: 'ordinary',
    registrationNumber: 'UP32A0001',
    state: 'assigned',
    blockers: null,
  },
  {
    id: 'D-1',
    routeName: 'EXP_2',
    startMin: 420,
    endMin: 1000,
    serviceClass: 'express',
    registrationNumber: null,
    state: 'no_bus',
    blockers: { notInYard: 0, offRoad: 0, dark: 0 },
  },
  {
    id: 'D-2',
    routeName: 'AC_3',
    startMin: 1380,
    endMin: 1560,
    serviceClass: 'ac',
    registrationNumber: null,
    state: 'bus_not_in_yard',
    blockers: { notInYard: 1, offRoad: 0, dark: 0 },
  },
];

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
  actGlobal.IS_REACT_ACT_ENVIRONMENT = originalActFlag;
});

function render(feedNow: string | null = '2026-10-06T10:00:00Z'): void {
  act(() =>
    root.render(
      <DutyBoard depotId="20" rows={buildBoardRows(DUTIES)} feedNow={feedNow} unmatched={null} />,
    ),
  );
}

const button = (name: string): HTMLButtonElement => {
  const found = [...container.querySelectorAll('button')].find((b) => b.textContent === name);
  if (!found) throw new Error(`no button ${name}`);
  return found;
};

describe('DutyBoard', () => {
  it('starts on the chart, with a state word, route and time on every row', () => {
    render();
    expect(container.querySelector('table')).toBeNull();
    const rows = [...container.querySelectorAll('[data-testid="duty-row"]')];
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toContain('Assigned');
    // Rewritten for the design wave: an unmatched row says "Unmatched"; its style is dashed.
    expect(rows[1]?.textContent).toContain('Unmatched');
    expect(rows[2]?.textContent).toContain('Unmatched');
    expect(rows[0]?.textContent).toContain('ORD_1');
    expect(rows[0]?.textContent).toContain('06:00 to 15:00');
    expect(button('Chart').getAttribute('aria-pressed')).toBe('true');
    expect(button('Table').getAttribute('aria-pressed')).toBe('false');
  });

  // Rewritten: the page's provenance line declares duties MODELLED once, so the
  // section label and the duty column carry no "(MODELLED)" (rulings section 2).
  it('carries no "(MODELLED)" in the section label or the duty column', () => {
    render();
    expect(container.textContent).not.toContain('(MODELLED)');
    expect(container.textContent).toContain('Duty timeline, 04:00 to 24:00');
  });

  it('writes the bus registration on the bar as a link to the roster', () => {
    render();
    const link = container.querySelector('a[href*="/roster?bus="]');
    expect(link?.textContent).toBe('UP32A0001');
    expect(link?.getAttribute('href')).toBe('/project/depots/d/20/roster?bus=UP32A0001');
  });

  it('draws the now line from the feed clock, and none without one', () => {
    render('2026-10-06T10:00:00Z');
    const line = container.querySelector<HTMLElement>('[data-testid="duty-now-line"]');
    expect(line?.style.left).toBe('30%');
    render(null);
    expect(container.querySelector('[data-testid="duty-now-line"]')).toBeNull();
    expect(container.querySelector('[data-testid="duty-now-label"]')).toBeNull();
  });

  it('labels the now line with its time at the axis', () => {
    render('2026-10-06T10:00:00Z');
    expect(container.querySelector('[data-testid="duty-now-label"]')?.textContent).toBe(
      'Now 10:00',
    );
  });

  // Rewritten: headers lose "(MODELLED)"; the reason is no longer a cell but the
  // selected row's detail line (the shared table has no row expander).
  it('switches to a table with the same rows and state words, and back', () => {
    render();
    act(() => button('Table').click());
    const table = container.querySelector('table');
    expect(table).not.toBeNull();
    expect(container.querySelector('[data-testid="duty-row"]')).toBeNull();
    const headers = [...(table?.querySelectorAll('th') ?? [])].map((th) => th.textContent);
    // A sorted header carries an arrow after its name, so match on the name.
    for (const name of ['Route', 'Start', 'End']) {
      expect(headers.some((h) => h?.startsWith(name))).toBe(true);
    }
    const body = [...(table?.querySelectorAll('tbody tr') ?? [])].map((tr) => tr.textContent);
    expect(body).toHaveLength(3);
    expect(body[0]).toContain('Assigned');
    expect(body[0]).toContain('UP32A0001');
    expect(headers.join(' ')).not.toContain('MODELLED');
    expect(body[1]).toContain('Unmatched');
    expect(body[2]).toContain('23:00');
    expect(body[2]).toContain('02:00 next day');
    expect(body[1]).not.toContain('No eligible bus is left');
    // The full text opens from the row's expander (the shared table's), not a selection.
    act(() =>
      table
        ?.querySelectorAll('tbody tr')[1]
        ?.querySelector('button[aria-expanded]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    expect(container.querySelector('[data-testid="duty-row-detail"]')?.textContent).toContain(
      'No eligible bus is left',
    );
    expect(button('Table').getAttribute('aria-pressed')).toBe('true');
    act(() => button('Chart').click());
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelectorAll('[data-testid="duty-row"]')).toHaveLength(3);
  });

  // Rewritten: the frame is a fixed-height pane scrolling both ways, axis stuck on top.
  it('keeps the chart in its own fixed-height scrolling pane', () => {
    render();
    const frame = container.querySelector('[data-testid="duty-scroll-frame"]');
    expect(frame?.className).toContain('relative');
    expect(frame?.className).toContain('overflow-auto');
    expect(frame?.className).toContain('max-h-[480px]');
    expect(frame?.querySelector('.sticky.top-0')).not.toBeNull();
  });

  it('gives every chart row its full text equivalent, with the reason and the word modelled', () => {
    render();
    const rows = [...container.querySelectorAll('[data-testid="duty-row"]')];
    const unassigned = rows[1]?.textContent ?? '';
    expect(unassigned).toContain('modelled');
    expect(unassigned).toContain('No eligible bus is left');
    expect(rows[0]?.textContent).toContain('(modelled). Assigned: UP32A0001');
    expect(container.querySelector('[title^="Route"]')).toBeNull();
  });

  it('announces the view it is showing in a status line', () => {
    render();
    const status = (): string | null =>
      container.querySelector('[data-testid="duty-view-status"]')?.textContent ?? null;
    expect(container.querySelector('[data-testid="duty-view-status"]')?.getAttribute('role')).toBe(
      'status',
    );
    expect(status()).toBe('Showing the chart, 3 duties');
    act(() => button('Table').click());
    expect(status()).toBe('Showing the table, 3 duties');
  });

  // Rewritten: the automatic fallback to the table is gone; 160 duties open on the chart.
  it('opens on the chart however many duties there are, with the reason line once', () => {
    const many: BoardDuty[] = Array.from({ length: 160 }, (_, i) => ({
      ...DUTIES[0]!,
      id: `D-${i}`,
      registrationNumber: `UP32A${i}`,
    }));
    act(() =>
      root.render(
        <DutyBoard
          depotId="20"
          rows={buildBoardRows(many)}
          feedNow={null}
          unmatched="No bus for 2 duties."
        />,
      ),
    );
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelectorAll('[data-testid="duty-row"]')).toHaveLength(160);
    expect(container.textContent?.split('No bus for 2 duties.')).toHaveLength(2);
  });

  it('places text that does not fit inside a short bar beside it', () => {
    render();
    const rows = [...container.querySelectorAll('[data-testid="duty-row"]')];
    const text = rows[0]?.querySelector<HTMLElement>('[data-testid="duty-bar-text"]');
    expect(text?.dataset.placement).toBe('inside');
    const short = rows[2]?.querySelector<HTMLElement>('[data-testid="duty-bar-text"]');
    expect(short?.dataset.placement).not.toBe('inside');
  });
});
