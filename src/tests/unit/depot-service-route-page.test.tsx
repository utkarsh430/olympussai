import { act, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RouteHourlyRoutePage from '@/app/(protected)/project/depots/routes/r/[routeName]/page';
import { SERVICE_HOW_PRODUCED } from '@/lib/depot/service/serviceWording';
import type { RouteHourlyResponse } from '@/lib/depot/service/types';
import { bannedOnScreen } from './depot-guard-rendered';
import { routeHourlyFixture } from './depot-service-fixtures';

/*
 * The route day's page from its real module, in every state: the gate it calls, its one
 * MIXED provenance line, its header, and nothing on screen that says "simulated", prints a
 * raw date or calls the sample or last-good data live.
 */

const state = vi.hoisted(() => ({
  polled: null as unknown,
  gates: [] as string[],
  feed: { source: 'live', stale: false } as { source: string; stale: boolean },
}));

vi.mock('@/lib/auth/server', () => ({
  requireProjectSession: async (path: string): Promise<void> => {
    state.gates.push(path);
  },
}));
vi.mock('@/hooks/useRouteHourly', () => ({ useRouteHourly: (): unknown => state.polled }));
vi.mock('@/components/depot/data/DepotNetworkProvider', () => ({
  useDepotNetworkContext: (): unknown => ({
    data: { ...state.feed, feedNow: '2026-10-06T11:24:00Z', fetchedAt: '2026-10-06T05:54:10.000Z', depots: [] },
    error: null,
  }),
}));
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) =>
      isValidElement(children)
        ? cloneElement(children as ReactElement<{ width: number; height: number }>, {
            width: 960,
            height: 300,
          })
        : null,
  };
});

const ROUTE = 'KANPUR-LUCKNOW';
const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let container: HTMLDivElement;
let root: Root;

function polled(over: { data?: RouteHourlyResponse | null; error?: string | null; loading?: boolean }): unknown {
  return { data: null, error: null, loading: false, refresh: () => undefined, ...over };
}

async function renderPage(routeName = ROUTE): Promise<void> {
  const page = await RouteHourlyRoutePage({ params: Promise.resolve({ routeName }) });
  act(() => root.render(page));
}

const line = (): HTMLElement | null =>
  container.querySelector<HTMLElement>('[data-testid="depot-provenance-line"]');

/** Every text, `title` and `aria-label` that says live, outside the class pills. */
function liveClaims(): string[] {
  const frame = container.cloneNode(true) as HTMLElement;
  for (const pill of frame.querySelectorAll('[data-testid="depot-provenance"]')) pill.remove();
  const attributes = Array.from(frame.querySelectorAll('[title], [aria-label]')).flatMap((el) => [
    el.getAttribute('title') ?? '',
    el.getAttribute('aria-label') ?? '',
  ]);
  const texts = Array.from(frame.querySelectorAll('*')).flatMap((el) =>
    Array.from(el.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent ?? ''),
  );
  return [...texts, ...attributes].filter((text) => /\blive\b/i.test(text));
}

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  state.gates.length = 0;
  state.feed = { source: 'live', stale: false };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const STATES = [
  ['loading', () => polled({ loading: true }), 'Loading the route’s day hour by hour'],
  ['error', () => polled({ error: 'Depot data unavailable' }), 'Depot data unavailable'],
  ['empty', () => polled({ data: routeHourlyFixture({ hours: [] }) }), 'the feed has not reported it'],
  ['data', () => polled({ data: routeHourlyFixture() }), 'Buses by hour'],
] as const;

describe('the route day page in every state', () => {
  it.each(STATES)('when %s, has one MIXED line, the header and its own sentence', async (_s, make, words) => {
    state.polled = make();
    await renderPage();
    expect(container.querySelectorAll('[data-testid="depot-provenance-line"]')).toHaveLength(1);
    expect(line()?.getAttribute('data-tone')).toBe('mixed');
    expect(line()?.textContent).toContain('MIXED');
    expect(line()?.textContent).toContain('passenger demand, buses needed and the proposals');
    expect(container.querySelector('h1')?.textContent).toBe('Hour by hour');
    expect(container.querySelector('.depot-eyebrow')?.textContent).toBe(ROUTE);
    expect(container.textContent).toContain(words);
    expect(bannedOnScreen(container)).toEqual([]);
  });

  it('carries the coverage in the provenance line once the day has loaded', async () => {
    state.polled = polled({ data: routeHourlyFixture() });
    await renderPage();
    expect(line()?.textContent).toContain('Scheduled trips known for 12 of 40 buses');
    state.polled = polled({ loading: true });
    await renderPage();
    expect(line()?.textContent).not.toContain('Scheduled trips known');
  });

  it.each([
    ['the saved sample', { source: 'fixture', stale: false }],
    ['last-good data', { source: 'live', stale: true }],
  ])('never calls %s live', async (_name, feed) => {
    state.feed = feed;
    state.polled = polled({ data: routeHourlyFixture(feed as Partial<RouteHourlyResponse>) });
    await renderPage();
    expect(liveClaims()).toEqual([]);
  });

  it('says in its method that modelled boardings follow the modelled trips', async () => {
    state.polled = polled({ data: routeHourlyFixture() });
    await renderPage();
    const sentence = SERVICE_HOW_PRODUCED.find((p) => p.includes('follow the modelled trips'));
    expect(sentence).toContain('when in the day buses are short');
    expect(container.textContent).toContain('the day’s modelled boardings follow the modelled trips');
  });

  it('says its modelled day is drawn from the route’s own buses, unlike the depot pages', async () => {
    state.polled = polled({ data: routeHourlyFixture() });
    await renderPage();
    const sentence = SERVICE_HOW_PRODUCED.find((p) => p.includes('drawn from the buses the feed shows'));
    expect(sentence).toContain('drawn per depot');
    expect(sentence).toContain('the two can differ');
    expect(container.textContent).toContain('This page’s modelled day is drawn from the buses the feed shows on this route');
  });

  it('says the need counts the trips still out over a cycle, and a bus works a day', () => {
    const needed = SERVICE_HOW_PRODUCED.find((p) => p.startsWith('Needed is'));
    expect(needed).toContain('started within the last journey time plus layover');
    expect(needed).toContain('an hour or less');
    expect(needed).not.toContain('times the round trip');
    const deployed = SERVICE_HOW_PRODUCED.find((p) => p.startsWith('Deployed is'));
    expect(deployed).toContain('6 to 10 hours');
  });

  it('gates the page on its own path before it renders', async () => {
    state.polled = polled({ loading: true });
    await renderPage();
    expect(state.gates).toEqual(['/project/depots/routes/r/KANPUR-LUCKNOW']);
  });

  it('refuses a malformed name before the session gate', async () => {
    await expect(RouteHourlyRoutePage({ params: Promise.resolve({ routeName: '../x' }) })).rejects.toThrow();
    expect(state.gates).toEqual([]);
  });
});
