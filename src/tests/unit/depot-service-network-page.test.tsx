import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NetworkServiceRoutePage from '@/app/(protected)/project/depots/service/page';
import type { NetworkHourlyResponse } from '@/lib/depot/service/types';
import { bannedOnScreen } from './depot-guard-rendered';
import { networkHourlyFixture } from './depot-service-network-response';

/*
 * The network "Service by the hour" page from its real module, in every state: the gate,
 * its one MIXED provenance line, its sections in order, the heat map and its table view,
 * the grouped proposals, the reallocation, and nothing on screen that says "simulated" or
 * prints a raw date.
 */

const state = vi.hoisted(() => ({
  polled: null as unknown,
  asks: [] as unknown[],
  gates: [] as string[],
  search: '' as string,
}));

vi.mock('@/lib/auth/server', () => ({
  requireProjectSession: async (path: string): Promise<void> => {
    state.gates.push(path);
  },
}));
vi.mock('next/navigation', () => ({
  useSearchParams: (): URLSearchParams => new URLSearchParams(state.search),
}));
vi.mock('@/hooks/useNetworkHourly', () => ({
  useNetworkHourly: (ask: unknown): unknown => {
    state.asks.push(ask);
    return state.polled;
  },
}));
vi.mock('@/components/depot/data/DepotNetworkProvider', () => ({
  useDepotNetworkContext: (): unknown => ({
    data: { source: 'live', stale: false, feedNow: '2026-10-06T11:24:00Z', fetchedAt: '2026-10-06T05:54:10.000Z', depots: [] },
    error: null,
  }),
}));

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let container: HTMLDivElement;
let root: Root;

function polled(over: { data?: NetworkHourlyResponse | null; error?: string | null; loading?: boolean }): unknown {
  return { data: null, error: null, loading: false, refresh: () => undefined, ...over };
}

async function renderPage(): Promise<void> {
  const page = await NetworkServiceRoutePage();
  act(() => root.render(page));
}

const line = (): HTMLElement | null => container.querySelector<HTMLElement>('[data-testid="depot-provenance-line"]');

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  state.gates.length = 0;
  state.asks.length = 0;
  state.search = '';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const STATES = [
  ['loading', () => polled({ loading: true }), 'Loading the network’s day hour by hour'],
  ['error', () => polled({ error: 'Depot data unavailable' }), 'Depot data unavailable'],
  ['empty', () => polled({ data: networkHourlyFixture({ routes: { total: 0, page: 0, pageSize: 25, rows: [] } }) }), 'No route reports a route name'],
  ['data', () => polled({ data: networkHourlyFixture() }), 'Routes by hour'],
] as const;

describe('the network service page in every state', () => {
  it.each(STATES)('when %s, has one MIXED line, the title and its own sentence', async (_s, make, words) => {
    state.polled = make();
    await renderPage();
    expect(container.querySelectorAll('[data-testid="depot-provenance-line"]')).toHaveLength(1);
    expect(line()?.getAttribute('data-tone')).toBe('mixed');
    expect(line()?.textContent).toContain('MODELLED');
    expect(container.querySelector('h1')?.textContent).toBe('Service by the hour');
    expect(container.textContent).toContain(words);
    expect(bannedOnScreen(container)).toEqual([]);
  });

  it('gates the page on its own path', async () => {
    state.polled = polled({ loading: true });
    await renderPage();
    expect(state.gates).toEqual(['/project/depots/service']);
  });
});

describe('the network service page with data', () => {
  beforeEach(async () => {
    state.polled = polled({ data: networkHourlyFixture() });
    await renderPage();
  });

  it('puts the heat map first, then the figures, proposals, reallocation and the method', () => {
    const order = ['service-heat-map', 'network-figure-band', 'service-network-proposals', 'service-reallocation']
      .map((id) => container.querySelector(`[data-testid="${id}"]`));
    expect(order.every((el) => el !== null)).toBe(true);
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(container.textContent).toContain('How these figures are produced');
  });

  it('draws 24 labelled cells per route, measured solid and modelled hatched, each route linked to its day', () => {
    const rows = container.querySelectorAll('[data-testid="heat-row"]');
    expect(rows).toHaveLength(3);
    const cells = rows[0]!.querySelectorAll('[role="cell"]');
    expect(cells).toHaveLength(24);
    expect(cells[7]?.getAttribute('data-basis')).toBe('measured');
    expect(cells[20]?.getAttribute('data-basis')).toBe('modelled');
    expect(cells[7]?.getAttribute('aria-label')).toBe('07:00: +4, short by 4 (measured)');
    expect(rows[0]!.querySelector('a')?.getAttribute('href')).toBe('/project/depots/routes/r/KANPUR-LUCKNOW');
    expect(container.textContent).toContain('Hatched: modelled day');
  });

  it('turns the heat map into a table in words', () => {
    const toggle = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Show as table')!;
    act(() => toggle.click());
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    const table = container.querySelector('[data-testid="service-heat-map"] table');
    expect(table?.textContent).toContain('+4 measured');
    expect(container.querySelectorAll('[data-testid="heat-row"]')).toHaveLength(0);
  });

  it('leads the figures with the routes short at the next peak, tagged MODELLED', () => {
    const band = container.querySelector('[data-testid="network-figure-band"]');
    expect(band?.textContent).toContain('Routes short at the next peak');
    expect(band?.textContent).toContain('MODELLED');
    expect(band?.textContent).toContain('Moves proposed');
  });

  it('groups the proposals and names their routes and depots', () => {
    const table = container.querySelector('[data-testid="service-network-proposals"]');
    expect(table?.textContent).toContain('Changes');
    expect(table?.textContent).toContain('Findings');
    expect(table?.textContent).toContain('Network moves');
    expect(table?.textContent).toContain('Reserve 2');
    expect(table?.textContent).toContain('Recommendation only');
  });

  it('shows the reallocation with its moves and why a deficit is left', () => {
    const section = container.querySelector('[data-testid="service-reallocation"]');
    expect(section?.textContent).toContain('1 bus moves within their depot and 2 between depots');
    expect(section?.textContent).toContain('Between depots');
    expect(section?.textContent).toContain('ran out of buses to spare');
  });

  it('asks again for the band or depot chosen, from page one', () => {
    const midday = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.startsWith('Midday'))!;
    act(() => midday.click());
    expect(state.asks.at(-1)).toEqual({ band: 'midday', depotId: null, page: 0 });
    const select = container.querySelector('select')!;
    act(() => {
      select.value = '34';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(state.asks.at(-1)).toEqual({ band: 'midday', depotId: '34', page: 0 });
  });
});

describe('the address', () => {
  it('starts on the depot and band it names, ignoring a malformed value', async () => {
    state.search = 'depot=34&band=late';
    state.polled = polled({ loading: true });
    await renderPage();
    expect(state.asks[0]).toEqual({ band: 'late', depotId: '34', page: 0 });
    state.search = 'depot=../x&band=night';
    state.asks.length = 0;
    act(() => root.unmount());
    root = createRoot(container);
    await renderPage();
    expect(state.asks[0]).toEqual({ band: null, depotId: null, page: 0 });
  });
});
