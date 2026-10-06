import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DutyBoard } from '@/components/depot/duties/DutyBoard';
import type { BoardDuty } from '@/lib/depot/duties/api';
import { CHART_DUTY_LIMIT, buildBoardRows } from '@/lib/depot/duties/dutyBoardModel';

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
    root.render(<DutyBoard depotId="20" rows={buildBoardRows(DUTIES)} feedNow={feedNow} />),
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
    expect(rows[1]?.textContent).toContain('No bus');
    expect(rows[2]?.textContent).toContain('Bus not in yard');
    expect(rows[0]?.textContent).toContain('ORD_1');
    expect(rows[0]?.textContent).toContain('06:00 to 15:00');
    expect(button('Chart').getAttribute('aria-pressed')).toBe('true');
    expect(button('Table').getAttribute('aria-pressed')).toBe('false');
  });

  it('tags the chart title and the duty column as MODELLED', () => {
    render();
    expect(container.querySelector('h2')?.textContent).toContain('MODELLED');
    expect(container.textContent).toContain('Duty (MODELLED)');
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
    expect(container.textContent).toContain('The feed has no clock');
  });

  it('switches to a table with the same rows, state words and MODELLED headers, and back', () => {
    render();
    act(() => button('Table').click());
    const table = container.querySelector('table');
    expect(table).not.toBeNull();
    expect(container.querySelector('[data-testid="duty-row"]')).toBeNull();
    const headers = [...(table?.querySelectorAll('th') ?? [])].map((th) => th.textContent);
    // A sorted header carries an arrow after its name, so match on the name.
    for (const name of ['Route (MODELLED)', 'Start (MODELLED)', 'End (MODELLED)']) {
      expect(headers.some((h) => h?.startsWith(name))).toBe(true);
    }
    const body = [...(table?.querySelectorAll('tbody tr') ?? [])].map((tr) => tr.textContent);
    expect(body).toHaveLength(3);
    expect(body[0]).toContain('Assigned');
    expect(body[0]).toContain('UP32A0001');
    expect(body[1]).toContain('No bus');
    expect(body[2]).toContain('Bus not in yard');
    expect(body[2]).toContain('23:00');
    expect(body[2]).toContain('02:00 next day');
    expect(body[1]).toContain('No free express bus');
    expect(button('Table').getAttribute('aria-pressed')).toBe('true');
    act(() => button('Chart').click());
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelectorAll('[data-testid="duty-row"]')).toHaveLength(3);
  });

  it('keeps the chart in its own horizontally scrolling frame', () => {
    render();
    const frame = container.querySelector('[data-testid="duty-scroll-frame"]');
    expect(frame?.className).toContain('relative');
    expect(frame?.className).toContain('overflow-x-auto');
  });

  it('gives every chart row its full text equivalent, with the reason and the word modelled', () => {
    render();
    const rows = [...container.querySelectorAll('[data-testid="duty-row"]')];
    const unassigned = rows[1]?.textContent ?? '';
    expect(unassigned).toContain('modelled');
    expect(unassigned).toContain('No free express bus');
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

  it('opens on the table past the limit and says why, with the chart one click away', () => {
    const many: BoardDuty[] = Array.from({ length: CHART_DUTY_LIMIT + 1 }, (_, i) => ({
      ...DUTIES[0]!,
      id: `D-${i}`,
      registrationNumber: `UP32A${i}`,
    }));
    act(() => root.render(<DutyBoard depotId="20" rows={buildBoardRows(many)} feedNow={null} />));
    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelector('[data-testid="duty-large-note"]')?.textContent).toContain(
      `more than ${CHART_DUTY_LIMIT}`,
    );
    act(() => button('Chart').click());
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelectorAll('[data-testid="duty-row"]')).toHaveLength(many.length);
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
