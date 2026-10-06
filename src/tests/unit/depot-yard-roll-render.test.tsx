import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { YardRoll } from '@/components/depot/yard/YardRoll';
import { YardNotEstablished } from '@/components/depot/yard/YardSummary';
import type { DepotBusView, VisitorBus } from '@/lib/depot/api';
import type { YardModel } from '@/lib/depot/yard/yardModel';

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
const originalActFlag = actGlobal.IS_REACT_ACT_ENVIRONMENT;
let container: HTMLDivElement;
let root: Root;

const bus = (reg: string, over: Partial<DepotBusView> = {}): DepotBusView =>
  ({
    registrationNumber: reg,
    state: 'standing',
    gpsAgeMin: 2,
    location: 'in_yard',
    ...over,
  }) as DepotBusView;

const visitor = (i: number): VisitorBus =>
  ({
    registrationNumber: `V${String(i).padStart(2, '0')}`,
    homeDepotName: 'Agra',
    homeDepotId: '1',
    state: 'standing',
    position: null,
  }) as VisitorBus;

const MODEL = {
  established: true,
  inYardGroups: [
    { state: 'standing', buses: [bus('A1'), bus('A2'), bus('A3', { gpsAgeMin: 90 })] },
  ],
  allGroups: [],
  visitorGroups: [
    {
      homeDepotId: '1',
      homeDepotName: 'Agra',
      buses: Array.from({ length: 20 }, (_, i) => visitor(i)),
    },
  ],
  away: { buses: [], total: 0 },
  unknown: [],
  counts: { inYard: 3, visitors: 20, away: 0, unknown: 0 },
  basis: 'A yard could not be established for this depot.',
  rule: 'A yard is placed where at least N parked buses stand together.',
  parkedWithPosition: 4,
} as unknown as YardModel;

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  actGlobal.IS_REACT_ACT_ENVIRONMENT = originalActFlag;
});

const button = (prefix: string): HTMLButtonElement | undefined =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.startsWith(prefix));

const darkBuses = Array.from({ length: 7 }, (_, i) =>
  bus(`D${i}`, { state: 'dark', gpsAgeMin: 19991 - i }),
);

const GROUPED = {
  ...MODEL,
  inYardGroups: [
    { state: 'standing', buses: [bus('A1'), bus('A2'), bus('A3', { gpsAgeMin: 90 })] },
    { state: 'dark', buses: darkBuses },
  ],
  counts: { inYard: 10, visitors: 20, away: 1, unknown: 0 },
  away: {
    buses: [bus('W1', { location: 'away', distanceFromYardKm: 3.21, gpsAgeMin: 130 })],
    total: 1,
  },
} as unknown as YardModel;

const group = (state: string): HTMLElement | null =>
  container.querySelector(`[data-testid="yard-roll-group"][data-state="${state}"]`);

describe('YardRoll group with nothing listed', () => {
  it('says so in one compact line under its heading, never an empty block', async () => {
    const model = {
      ...GROUPED,
      inYardGroups: [
        { state: 'in_service', buses: [bus('S1', { state: 'in_service' }), bus('S2', { state: 'in_service' })] },
        { state: 'dark', buses: darkBuses },
      ],
    } as unknown as YardModel;
    await act(async () => {
      root.render(<YardRoll model={model} depotId="20" depotNames={new Map()} />);
    });
    const quiet = group('in_service');
    expect(quiet?.querySelector('table')).toBeNull();
    expect(quiet?.querySelector('.depot-note')?.textContent).toBe('None listed.');
    expect(group('dark')?.querySelector('.depot-note')).toBeNull();
  });
});

describe('YardRoll', () => {
  beforeEach(async () => {
    await act(async () => {
      root.render(<YardRoll model={GROUPED} depotId="20" depotNames={new Map()} />);
    });
  });

  it('counts every bus in the yard by state and lists only buses with a live reason', () => {
    const roll = container.querySelector('[data-testid="yard-roll"]');
    expect(roll?.querySelector('[data-testid="depot-section-label"]')?.textContent).toContain('10');
    expect(group('standing')?.textContent).toContain('Standing');
    expect(group('standing')?.textContent).toContain('3');
    expect(group('standing')?.textContent).toContain('STANDING · 3 · 1 LISTED');
    expect(group('standing')?.textContent).toContain('A3');
    expect(group('standing')?.textContent).not.toContain('A1');
    expect(group('standing')?.textContent).toContain('not heard recently');
    expect(group('dark')?.textContent).toContain('ALL LISTED');
  });

  it('puts the listing rule in the section label note and never a modelled parking reason', () => {
    const roll = container.querySelector('[data-testid="yard-roll"]')?.textContent ?? '';
    expect(roll).toContain('Listed: off the road, dark, or not heard for 1 h or more');
    expect(roll).not.toMatch(/lane|parking/i);
  });

  it('is a table of registration, not heard and reason, at most 760px wide, with durations', () => {
    const table = group('standing')?.querySelector('table');
    const headers = [...(table?.querySelectorAll('thead th') ?? [])].map((th) => th.textContent);
    expect(headers.join('|')).toMatch(/Registration.*\|Not heard.*\|Reason/);
    expect(group('standing')?.querySelector('.max-w-\\[760px\\]')).not.toBeNull();
    expect(group('dark')?.textContent).toContain('13 d 21 h');
    expect(group('dark')?.textContent).not.toMatch(/\d{3,} min/);
  });

  it('drops the reason column from a group whose state already says why, and never repeats the state', () => {
    const headers = group('dark')?.querySelector('thead')?.textContent ?? '';
    expect(headers).not.toContain('Reason');
    const cells = [...(group('dark')?.querySelectorAll('tbody td') ?? [])].map((td) => td.textContent);
    for (const cell of cells) expect(cell).not.toMatch(/dark/i);
  });

  it('sets the state groups side by side from 1280px, so the list is half as tall', () => {
    const groups = container.querySelector('[data-testid="yard-roll-groups"]');
    expect(groups?.className).toContain('xl:grid-cols-2');
    expect(groups?.className).toContain('grid');
    expect(groups?.querySelectorAll('[data-testid="yard-roll-group"]').length).toBeGreaterThan(1);
  });

  it('shows five rows per group with the shared "Show all N"', async () => {
    expect(group('dark')?.querySelectorAll('tbody tr')).toHaveLength(5);
    const all = button('Show all 7');
    expect(all?.getAttribute('aria-expanded')).toBe('false');
    await act(async () => all?.click());
    expect(group('dark')?.querySelectorAll('tbody tr')).toHaveLength(7);
  });

  it('shows five visitors in one table with a depot column, and shows all on request', async () => {
    // The same cap as every other capped group on the page: five, then "Show all N".
    const section = container.querySelector('[aria-labelledby="yard-roll-visitors"]');
    expect(section?.querySelector('table')?.textContent).toContain('Home depot');
    expect(section?.querySelectorAll('tbody tr')).toHaveLength(5);
    await act(async () => button('Show all 20')?.click());
    expect(section?.querySelectorAll('tbody tr')).toHaveLength(20);
  });

  it('gives away buses the same table treatment with the distance in a km column', () => {
    const section = container.querySelector('[aria-labelledby="yard-roll-away"]');
    expect(section?.querySelector('thead')?.textContent).toMatch(/From yard.*km/);
    expect(section?.querySelector('tbody')?.textContent).toContain('3.2');
    expect(section?.querySelector('tbody')?.textContent).toContain('2 h 10 min');
    expect(section?.querySelector('.max-w-\\[760px\\]')).not.toBeNull();
  });
});

describe('YardNotEstablished', () => {
  it('says how many snapshots it has decided the yard on when it has seen one or none', async () => {
    await act(async () => root.render(<YardNotEstablished model={MODEL} snapshotsSeen={1} />));
    expect(container.textContent).toContain("This server has decided this depot's yard on 1 snapshot so far");
    expect(container.textContent).not.toContain('just started');
  });

  it('takes the map place with one sentence, one muted line and one action; the rule is behind a link', async () => {
    await act(async () => root.render(<YardNotEstablished model={MODEL} snapshotsSeen={40} />));
    const panel = container.querySelector('[data-testid="yard-not-established"]');
    expect(panel?.textContent).toContain(
      'No yard is established yet: too few parked buses report a position together.',
    );
    expect(panel?.textContent).toContain('4 parked buses with a position');
    expect(panel?.textContent).not.toContain('A yard is placed where');
    expect(panel?.querySelector('a[href="#yard-roll-in"]')?.textContent).toContain(
      'See the buses by state',
    );
    expect(panel?.textContent).toContain('How a yard is found');
  });
});
