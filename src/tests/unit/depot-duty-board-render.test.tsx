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
    busStanding: 'on_road',
    busClass: 'express',
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
      <DutyBoard
        depotId="20"
        rows={buildBoardRows(DUTIES)}
        feedNow={feedNow}
        figures={[]}
        notes={['No bus for 2 duties: every eligible bus has another duty.']}
      />,
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
    // Rewritten for round 2: "Matched", never "Assigned" (critique Must 2, guard X4).
    expect(rows[0]?.textContent).toContain('Matched');
    expect(container.textContent).not.toContain('Assigned');
    expect(rows[1]?.textContent).toContain('Unmatched');
    expect(rows[2]?.textContent).toContain('Unmatched');
    expect(rows[0]?.textContent).toContain('ORD_1');
    expect(rows[0]?.textContent).toContain('06:00 to 15:00');
    expect(button('Chart').getAttribute('aria-pressed')).toBe('true');
    expect(button('Table').getAttribute('aria-pressed')).toBe('false');
  });

  // Rewritten for round 2 (ruling S51, guard X4): the timeline places the modelled
  // matching beside real registrations on a MIXED page, so its visible section label
  // carries the MODELLED tag, once; no "(MODELLED)" in header text.
  it('tags the visible timeline section label MODELLED, once', () => {
    render();
    const label = container.querySelector('[data-testid="depot-section-label"]');
    expect(label?.textContent).toContain('Duty timeline');
    expect(label?.textContent).toContain('MODELLED');
    expect(container.textContent?.match(/MODELLED/g)).toHaveLength(1);
    expect(container.textContent).not.toContain('(MODELLED)');
    expect(label?.parentElement?.querySelector('[aria-label="Show duties as"]')).not.toBeNull();
  });

  it('draws unmatched bars neutral with no word, and a bus on the road with a thick edge', () => {
    render();
    const bars = [...container.querySelectorAll<HTMLElement>('[data-testid="duty-bar"]')];
    expect(bars[0]?.dataset.standing).toBe('on_road');
    expect(bars[0]?.className).toContain('border-l-4');
    expect(bars[1]?.className).toContain('border-dashed');
    expect(bars[1]?.className).not.toContain('border-alert-crimson');
    const rows = [...container.querySelectorAll('[data-testid="duty-row"]')];
    expect(rows[1]?.querySelector('[data-testid="duty-bar-text"]')).toBeNull();
    expect(container.querySelector('[aria-label="Legend"]')?.textContent).toContain('on the road now');
  });

  it('opens the shared row expander from a chart row, with how the bus stands and its class', () => {
    render();
    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="duty-row"] button[aria-expanded]',
    );
    act(() => toggle?.click());
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    const detail = container.querySelector('[data-testid="duty-row-detail"]')?.textContent ?? '';
    expect(detail).toContain('On the road');
    expect(detail).toContain('Express');
    expect(detail).toContain('Ordinary');
  });

  it('keeps the now flag on its own line of the axis, and says why there is no line', () => {
    render('2026-10-06T23:58:00Z');
    expect(container.querySelector<HTMLElement>('[data-testid="duty-now-label"]')?.dataset.anchor).toBe(
      'end',
    );
    expect(container.querySelector('[data-testid="duty-now-label"]')?.className).toContain('bottom-1');
    render(null);
    expect(container.querySelector('[data-testid="duty-now-sentence"]')?.textContent).toBe(
      'The feed has no clock, so there is no now line.',
    );
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

  // Rewritten for round 2: the State and Bus headers carry the MODELLED tag (S51, X4);
  // the expander shows the duty in full and no reason (said once above the chart).
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
    expect(body[0]).toContain('Matched');
    expect(body[0]).toContain('UP32A0001');
    expect(body[0]).toContain('Ordinary · Express bus');
    expect(body[0]).toContain('On the road');
    const tagged = [...(table?.querySelectorAll('th') ?? [])].filter((th) =>
      th.textContent?.includes('MODELLED'),
    );
    expect(tagged.map((th) => th.textContent?.replace('MODELLED', '').trim())).toEqual([
      'State',
      'Bus',
    ]);
    expect(body[1]).toContain('Unmatched');
    expect(body[2]).toContain('23:00');
    expect(body[2]).toContain('02:00 next day');
    act(() =>
      table
        ?.querySelectorAll('tbody tr')[1]
        ?.querySelector('button[aria-expanded]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
    );
    const detail = container.querySelector('[data-testid="duty-row-detail"]')?.textContent ?? '';
    expect(detail).toContain('Unmatched');
    expect(detail).not.toMatch(/held out|not in the yard/i);
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

  // Rewritten for round 2: no reason per row (said once above the chart) and no
  // "(modelled)" per row (the section label carries the tag); how the bus stands is said.
  it('gives every chart row its full text equivalent, the reason only once above the chart', () => {
    render();
    const rows = [...container.querySelectorAll('[data-testid="duty-row"]')];
    expect(rows[0]?.textContent).toContain(
      'Matched: UP32A0001, on the road now, an Express bus.',
    );
    expect(rows[1]?.textContent).toContain('Route EXP_2, Express, 07:00 to 16:40. Unmatched.');
    expect(container.textContent?.split('No bus for 2 duties')).toHaveLength(2);
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
          figures={[]}
          notes={['No bus for 2 duties.']}
        />,
      ),
    );
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelectorAll('[data-testid="duty-row"]')).toHaveLength(160);
    expect(container.textContent?.split('No bus for 2 duties.')).toHaveLength(2);
  });

  // Rewritten for round 2: unmatched bars carry no text, so the short bar is a matched one.
  it('places text that does not fit inside a short bar beside it', () => {
    const short: BoardDuty = { ...DUTIES[0]!, id: 'S', startMin: 1380, endMin: 1440 };
    act(() =>
      root.render(
        <DutyBoard
          depotId="20"
          rows={buildBoardRows([DUTIES[0]!, short])}
          feedNow={null}
          figures={[]}
          notes={[]}
        />,
      ),
    );
    const texts = [...container.querySelectorAll<HTMLElement>('[data-testid="duty-bar-text"]')];
    expect(texts[0]?.dataset.placement).toBe('inside');
    expect(texts[1]?.dataset.placement).not.toBe('inside');
  });
});
