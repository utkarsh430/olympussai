import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DepotsOverviewPage from '@/app/(protected)/project/depots/page';
import type { DepotSummary, Figure, NetworkKpis } from '@/lib/depot/types';
import { bannedOnScreen } from './depot-guard-rendered';

/*
 * Guard review X1 and X11: the overview's real page in every state. The provenance line
 * is the page's only statement of its default (DERIVED) and carries the index window, so
 * changing the default or dropping the window words must fail here. Queried on the
 * visible page, outside the closed "How these figures are produced" disclosure.
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
const NONE = { emergency: 0, dark_share_high: 0, off_road_high: 0, on_road_low: 0, power_cut_cluster: 0, long_dark: 0, power_cut: 0, tamper_code: 0 };

function data(depots: readonly DepotSummary[]): unknown {
  return {
    stale: false,
    feedNow: FEED_NOW,
    depots,
    scores: [],
    kpis: KPIS,
    exceptionCounts: NONE,
    exceptionSeverityCounts: { critical: 0, warning: 0, info: 0 },
    scoreWindow: { lengthMin: 20, since: '2026-10-06T08:31:00.000Z', samples: 20, coveredMin: 20 },
  };
}

const base = { data: null, error: null, loading: false, refresh: () => undefined };
const STATES: ReadonlyArray<readonly [string, unknown]> = [
  ['loading', { ...base, loading: true }],
  ['error', { ...base, error: 'Request failed' }],
  ['empty', { ...base, data: data([]) }],
  ['data', { ...base, data: data([DEPOT]) }],
];

async function visible(): Promise<string> {
  const markup = renderToStaticMarkup(await DepotsOverviewPage());
  const cut = markup.indexOf('<details');
  return (cut === -1 ? markup : markup.slice(0, cut)).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
}

describe('the network overview page', () => {
  beforeEach(() => {
    ctx.network = base;
  });

  it.each(STATES)('shows no "simulated" and no raw date in the %s state', async (_name, network) => {
    ctx.network = network;
    expect(bannedOnScreen(renderToStaticMarkup(await DepotsOverviewPage()))).toEqual([]);
  });

  it.each(STATES)('declares DERIVED in its provenance line in the %s state', async (_name, network) => {
    ctx.network = network;
    const page = await visible();
    expect(page).toContain('DERIVED');
    expect(page).not.toMatch(/\bMIXED\b|\bLIVE\b/);
    expect(page).toContain('Network overview');
  });

  it.each(STATES.slice(2))(
    'says the feed time and the efficiency-index window on the page in the %s state',
    async (_name, network) => {
      ctx.network = network;
      const page = await visible();
      expect(page).toMatch(/DERIVED Computed from the live feed at \d\d:\d\d\./);
      expect(page).toContain('Efficiency index over the last 20 minutes.');
    },
  );

  it('carries the one MODELLED tag of the page only beside the band, never in the provenance line', async () => {
    ctx.network = { ...base, data: data([DEPOT]) };
    const markup = renderToStaticMarkup(await DepotsOverviewPage());
    const head = markup.slice(0, markup.indexOf('data-testid="depot-overview"'));
    expect(head).not.toContain('MODELLED');
  });

  it('shows a unit row in the classified states, adding up to its fleet', async () => {
    ctx.network = { ...base, data: data([DEPOT]) };
    const page = await visible();
    expect(page).toMatch(/On road Standing Dark Off road/i);
    expect(page).not.toMatch(/No signal|Stationary|Maint\b/i);
  });
});
