import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NetworkTrendsPage from '@/app/(protected)/project/depots/trends/page';
import DepotTrendsPage from '@/app/(protected)/project/depots/d/[depotId]/trends/page';
import {
  distributionResponse,
  forecastResponse,
  polled,
  trendRow,
  trendsResponse,
} from './depot-trends-fixtures';

const hooks = vi.hoisted(() => ({
  forecast: vi.fn(),
  trends: vi.fn(),
  distribution: vi.fn(),
  gates: [] as string[],
}));

vi.mock('@/components/depot/trendChart/TrendPlot', () => ({ TrendPlot: () => null }));
vi.mock('@/hooks/useDepotForecast', () => ({ useDepotForecast: hooks.forecast }));
vi.mock('@/hooks/useDepotTrends', () => ({ useDepotTrends: hooks.trends }));
vi.mock('@/hooks/useDepotDistribution', () => ({ useDepotDistribution: hooks.distribution }));
vi.mock('@/components/depot/data/DepotDetailProvider', () => ({
  useDepotDetailContext: () => ({ depotId: '20', error: null }),
}));
vi.mock('@/components/depot/data/DepotNetworkProvider', () => ({
  useDepotNetworkContext: () => ({ data: null, error: null }),
}));
vi.mock('@/lib/auth/server', () => ({
  requireProjectSession: async (path: string): Promise<void> => {
    hooks.gates.push(`session ${path}`);
  },
}));
vi.mock('@/lib/depot/depotGate', () => ({
  requireDepotPage: async (id: string, suffix: string): Promise<void> => {
    hooks.gates.push(`depot ${id}${suffix}`);
  },
}));

const text = (markup: string): string => markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

/** The two pages' real top-level components, as the router renders them. */
const PAGES = [
  [
    'network',
    async (): Promise<string> =>
      renderToStaticMarkup(await NetworkTrendsPage({ searchParams: Promise.resolve({}) })),
  ],
  [
    'depot',
    async (): Promise<string> =>
      renderToStaticMarkup(
        await DepotTrendsPage({
          params: Promise.resolve({ depotId: '20' }),
          searchParams: Promise.resolve({}),
        }),
      ),
  ],
] as const;

const STATES = [
  ['loading', () => polled(null, { loading: true })],
  ['error', () => polled(null, { error: 'Depot data unavailable' })],
  ['too little history', () => polled(forecastResponse('onRoadShare', 20))],
  ['data', () => polled(forecastResponse('onRoadShare', 70))],
] as const;

const PROVENANCE_SENTENCE =
  'Generated from planning assumptions, not measured. Replaced when a database of real history is connected.';

beforeEach(() => {
  hooks.gates.length = 0;
  hooks.trends.mockReturnValue(polled(trendsResponse([trendRow('1', 2.1), trendRow('2', -3)])));
  hooks.distribution.mockReturnValue(polled(distributionResponse('20', 40)));
});

describe.each(PAGES)('the %s Trends page provenance', (_page, render) => {
  it.each(STATES)('prints its MODELLED provenance line in the %s state', async (_state, make) => {
    hooks.forecast.mockImplementation((request: unknown) => (request === null ? polled(null) : make()));
    if (_state === 'loading' || _state === 'error') hooks.trends.mockReturnValue(make());
    const markup = await render();
    const page = text(markup);
    const line = markup.match(/<div[^>]*data-testid="depot-provenance-line"[^>]*>[\s\S]*?<\/div>/)?.[0] ?? '';
    expect(line).toContain('data-tone="modelled"');
    expect(text(line)).toContain('MODELLED');
    expect(text(line)).toContain(PROVENANCE_SENTENCE);
    // Exactly one provenance line, before the page body.
    expect(markup.match(/data-testid="depot-provenance-line"/g)).toHaveLength(1);
    expect(markup.indexOf('depot-provenance-line')).toBeLessThan(
      markup.indexOf('data-testid="trends-metric-chooser"'),
    );
    expect(page.toLowerCase()).not.toContain('simulated');
  });
});

describe('the gate calls', () => {
  it('keeps the network page behind the project session and the depot page behind its depot gate', async () => {
    hooks.forecast.mockReturnValue(polled(null, { loading: true }));
    await PAGES[0][1]();
    await PAGES[1][1]();
    expect(hooks.gates).toEqual(['session /project/depots/trends', 'depot 20/trends']);
  });
});
