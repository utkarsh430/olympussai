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

describe('YardRoll', () => {
  it('lists only the buses that need action, with the rule, and the rest behind "Show all"', async () => {
    await act(async () => {
      root.render(
        <YardRoll model={MODEL} depotId="20" depotNames={new Map()} outOfLane={new Set(['A2'])} />,
      );
    });
    const action = container.querySelector('[data-testid="yard-roll-action"]')?.textContent ?? '';
    expect(action).toContain('A2');
    expect(action).toContain('not in a lane');
    expect(action).toContain('A3');
    expect(action).toContain('not heard for 90 min');
    expect(action).not.toContain('A1');
    expect(container.textContent).toContain('not heard for 60 minutes or more');
    const all = button('Show all 3');
    expect(all?.getAttribute('aria-expanded')).toBe('false');
    await act(async () => all?.click());
    expect(container.textContent).toContain('A1');
  });

  it('caps visitors at 15 rows in one table with a depot column, and shows all on request', async () => {
    await act(async () => {
      root.render(
        <YardRoll model={MODEL} depotId="20" depotNames={new Map()} outOfLane={new Set()} />,
      );
    });
    const table = container.querySelector('table');
    expect(table?.textContent).toContain('Home depot');
    expect(table?.querySelectorAll('tbody tr')).toHaveLength(15);
    await act(async () => button('Show all 20')?.click());
    expect(container.querySelector('table')?.querySelectorAll('tbody tr')).toHaveLength(20);
  });
});

describe('YardNotEstablished', () => {
  it('takes the map place with the rule sentence in a state panel', async () => {
    await act(async () => root.render(<YardNotEstablished model={MODEL} />));
    expect(container.querySelector('[data-testid="yard-not-established"]')).not.toBeNull();
    expect(container.textContent).toContain('A yard is placed where');
    expect(container.textContent).toContain('4 are now');
  });
});
