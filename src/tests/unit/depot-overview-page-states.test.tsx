import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DepotsOverviewPage from '@/app/(protected)/project/depots/page';
import type { DepotScore } from '@/lib/depot/score/types';
import type { DepotSummary, Figure, NetworkKpis } from '@/lib/depot/types';

/*
 * The provenance line and the date rule, on the page's real top-level component (the route's
 * default export, gate and header included), mounted in jsdom so effects run:
 * - the provenance line is driven through its own states: waiting, unavailable, stale,
 *   empty and data, and each says its own words;
 * - no raw YYYY-MM-DD reaches the rendered text, a `title` or an `aria-label`, in any state.
 */

const ctx = vi.hoisted(() => ({ network: null as unknown }));

vi.mock('@/lib/auth/server', () => ({ requireProjectSession: async (): Promise<void> => {} }));
vi.mock('@/components/depot/data/DepotNetworkProvider', () => ({
  useDepotNetworkContext: (): unknown => ctx.network,
}));
vi.mock('@/hooks/useDepotForecast', () => ({
  useDepotForecast: () => ({ data: null, error: null, loading: true, refresh: () => undefined }),
}));

const FEED_NOW = '2026-10-06T08:51:00.000Z';
const derived = (value: number): Figure => ({ value, provenance: 'derived' });
const KPIS: NetworkKpis = {
  fleet: derived(40),
  depots: derived(1),
  reporting: derived(35),
  onRoad: derived(20),
  stationary: derived(10),
  noSignal: derived(5),
  underMaintenance: derived(5),
  assigned: derived(20),
};
const DEPOT: DepotSummary = {
  id: 'a',
  name: 'KAUSHAMBI',
  kind: 'depot',
  fleet: 40,
  status: { live: 20, stationary: 10, noSignal: 5, underMaintenance: 5, unknown: 0 },
  states: { inService: 15, onRoad: 5, standing: 10, dark: 5, offRoad: 5 },
  reporting: 35,
  positioned: 35,
  assigned: 20,
  powerCut: 0,
  tamperFlagged: 0,
  centroid: { lat: 26.8, lng: 80.9 },
};
const COUNTS = {
  emergency: 1, dark_share_high: 1, off_road_high: 0, on_road_low: 0,
  power_cut_cluster: 0, long_dark: 3, power_cut: 0, tamper_code: 0,
};

function data(depots: readonly DepotSummary[], stale = false): unknown {
  const scores: DepotScore[] = depots.map((depot) => ({
    depotId: depot.id,
    peerGroup: 'medium',
    ranked: true,
    reason: 'ok',
    index: 61.2,
    rank: 1,
    peerCount: 1,
    components: [],
  }));
  return {
    stale,
    feedNow: FEED_NOW,
    depots,
    scores,
    kpis: KPIS,
    exceptionCounts: COUNTS,
    exceptionSeverityCounts: { critical: 1, warning: 1, info: 3 },
    scoreWindow: { lengthMin: 20, since: '2026-10-06T08:31:00.000Z', samples: 20, coveredMin: 20 },
  };
}

const refresh = (): void => undefined;
const STATES: ReadonlyArray<readonly [string, unknown]> = [
  ['waiting', { data: null, error: null, loading: true, refresh }],
  ['unavailable', { data: null, error: 'Request failed', loading: false, refresh }],
  ['stale', { data: data([DEPOT], true), error: null, loading: false, refresh }],
  ['empty', { data: data([]), error: null, loading: false, refresh }],
  ['data', { data: data([DEPOT]), error: null, loading: false, refresh }],
];

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renderPage(network: unknown): Promise<void> {
  ctx.network = network;
  const page = await DepotsOverviewPage();
  await act(async () => root.render(page));
}

function line(): Element | null {
  return container.querySelector('[data-testid="depot-provenance-line"]');
}

const WORDS: Readonly<Record<string, RegExp>> = {
  waiting: /^DERIVED ?Waiting for the feed\.$/,
  unavailable: /^DERIVED ?The feed is unavailable\.$/,
  stale: /^DERIVED ?Computed from the last good data, feed time \d\d:\d\d\. Efficiency index over the last 20 minutes\.$/,
  empty: /^DERIVED ?Computed from the live feed at \d\d:\d\d\. Efficiency index over the last 20 minutes\.$/,
  data: /^DERIVED ?Computed from the live feed at \d\d:\d\d\. Efficiency index over the last 20 minutes\.$/,
};

describe('the overview provenance line, driven through its own states', () => {
  it.each(STATES)('says its own words in the %s state, one line, under the h1', async (name, network) => {
    await renderPage(network);
    expect(container.querySelectorAll('[data-testid="depot-provenance-line"]')).toHaveLength(1);
    expect(line()?.getAttribute('data-tone')).toBe('derived');
    expect(line()?.textContent).toMatch(WORDS[name]!);
    expect(container.querySelector('h1')?.textContent).toBe('Headquarters overview');
  });

  it('draws "last good data" in the stale tone only when the data is stale', async () => {
    await renderPage(STATES[2]![1]);
    expect(line()?.querySelector('[data-testid="depot-provenance-stale"]')?.textContent).toBe(
      'last good data',
    );
    await renderPage(STATES[4]![1]);
    expect(line()?.querySelector('[data-testid="depot-provenance-stale"]')).toBeNull();
  });

  it('never says the feed time or the index window while there is no data', async () => {
    for (const [, network] of STATES.slice(0, 2)) {
      await renderPage(network);
      expect(line()?.textContent).not.toMatch(/\d\d:\d\d|Efficiency index/);
    }
  });
});

const RAW_DATE = /\d{4}-\d{2}-\d{2}/;

/** Everything a reader or assistive technology can meet: text, titles, accessible names. */
function readable(): string {
  const attrs = Array.from(container.querySelectorAll('*')).flatMap((el) =>
    ['title', 'aria-label', 'alt', 'placeholder'].map((name) => el.getAttribute(name) ?? ''),
  );
  return [container.textContent ?? '', ...attrs].join(' | ');
}

describe('the overview never prints a raw date (date rule)', () => {
  it.each(STATES)('has no YYYY-MM-DD in its text, titles or aria-labels in the %s state', async (_name, network) => {
    await renderPage(network);
    expect(readable()).not.toMatch(RAW_DATE);
  });

  it('would catch one: the guard sees a title and an aria-label', async () => {
    await renderPage(STATES[4]![1]);
    // The whole body is drawn, so the scan above covered it: table, exceptions, briefing row.
    expect(container.textContent).toContain('KAUSHAMBI');
    expect(container.textContent).toContain('All units');
    expect(container.textContent).toContain('Headquarters briefing');
    expect(container.textContent).toContain('Exceptions');
    const probe = document.createElement('span');
    probe.setAttribute('aria-label', 'as of 2026-10-06');
    container.firstElementChild?.appendChild(probe);
    expect(readable()).toMatch(RAW_DATE);
    probe.remove();
    probe.removeAttribute('aria-label');
    probe.setAttribute('title', '2026-10-06');
    container.firstElementChild?.appendChild(probe);
    expect(readable()).toMatch(RAW_DATE);
  });
});
