import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusBoard } from '@/components/depot/cockpit/StatusBoard';
import { LeagueGrid } from '@/components/depot/league/LeagueGrid';
import { KpiBand } from '@/components/depot/network/KpiBand';
import type { StatusBoard as StatusBoardModel } from '@/lib/depot/cockpit/cockpitModel';
import type { LeagueRow } from '@/lib/depot/league/leagueModel';
import type { Figure, NetworkKpis } from '@/lib/depot/types';
import { metricInfo } from '@/lib/depot/forecast/wording';
import { forecastResponse, polled, trendRow, trendsResponse } from './depot-trends-fixtures';

const hooks = vi.hoisted(() => ({ forecast: vi.fn(), trends: vi.fn() }));

vi.mock('@/hooks/useDepotForecast', () => ({ useDepotForecast: hooks.forecast }));
vi.mock('@/hooks/useDepotTrends', () => ({ useDepotTrends: hooks.trends }));
vi.mock('@/components/depot/data/DepotDetailProvider', () => ({
  useDepotDetailContext: () => ({ depotId: '20' }),
}));

const text = (markup: string): string => markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

const live = (value: number): Figure => ({ value, provenance: 'live' });
const KPIS: NetworkKpis = {
  fleet: live(100),
  depots: live(3),
  reporting: live(90),
  onRoad: live(70),
  stationary: live(10),
  noSignal: live(5),
  underMaintenance: live(4),
  assigned: live(60),
};

function leagueRow(id: string): LeagueRow {
  return {
    depotId: id,
    name: `Depot ${id}`,
    kind: 'depot',
    fleet: 100,
    peerGroup: 'medium',
    ranked: true,
    rank: 1,
    index: 61.2,
    peerCount: 12,
    components: [],
    score: null,
  };
}

beforeEach(() => {
  hooks.forecast.mockReset();
  hooks.trends.mockReset();
  hooks.forecast.mockImplementation((request: { metric: 'onRoadShare' } | null) =>
    polled(request === null ? null : forecastResponse(request.metric, 70)),
  );
  hooks.trends.mockReturnValue(polled(trendsResponse([trendRow('a', 2.1)])));
});

describe('overview KPI band', () => {
  it('asks only for the figures that have a history metric, for the network', () => {
    renderToStaticMarkup(<KpiBand kpis={KPIS} depots={[]} />);
    const requests = hooks.forecast.mock.calls.map(([request]) => request);
    expect(requests.filter((r) => r !== null)).toEqual([
      { metric: 'onRoadShare', scope: { kind: 'network' } },
      { metric: 'darkRate', scope: { kind: 'network' } },
    ]);
  });

  it('names the metric and tags the week MODELLED, leaving the live tag as it was', () => {
    const markup = renderToStaticMarkup(<KpiBand kpis={KPIS} depots={[]} />);
    const page = text(markup);
    expect(page).toMatch(/On-road share, MODELLED: (steady|up|down)[^]*over 7 days/);
    expect(page).toMatch(/Dark rate, MODELLED: (steady|up|down)[^]*over 7 days/);
    expect(markup.match(/data-testid="trend-week-line"/g)).toHaveLength(2);
    expect(markup.match(/data-provenance="live"/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('prints nothing while the trend is loading', () => {
    hooks.forecast.mockReturnValue(polled(null, { loading: true }));
    expect(renderToStaticMarkup(<KpiBand kpis={KPIS} depots={[]} />)).not.toContain(
      'trend-week-line',
    );
  });
});

describe('cockpit status board', () => {
  it('puts the on-road share week beside the on-road figure, for this depot', () => {
    const board = {
      fleet: 10,
      states: [
        { state: 'on_road', label: 'On road', count: 6 },
        { state: 'dark', label: 'Dark', count: 4 },
      ],
      standing: 0,
      locations: null,
      yard: { established: false as const, sentence: 'No yard.' },
    } as unknown as StatusBoardModel;
    const status = { live: 0, stationary: 0, noSignal: 0, underMaintenance: 0, unknown: 0 };
    const markup = renderToStaticMarkup(<StatusBoard board={board} status={status} />);
    expect(hooks.forecast).toHaveBeenCalledWith({
      metric: 'onRoadShare',
      scope: { kind: 'depot', depotId: '20' },
    });
    const cell = markup.slice(
      markup.indexOf('depot-state-on_road'),
      markup.indexOf('depot-state-dark'),
    );
    expect(text(cell)).toMatch(/On-road share, MODELLED: .* over 7 days/);
    expect(markup.match(/data-testid="trend-week-line"/g)).toHaveLength(1);
  });
});

describe('league grid', () => {
  it('fetches the index trends once for every row and tags the column MODELLED', () => {
    const index = { ...trendsResponse([trendRow('a', 2.1)]), metric: metricInfo('index') };
    hooks.trends.mockReturnValue(polled({ ...index, trendUnit: 'points' }));
    const markup = renderToStaticMarkup(
      <LeagueGrid
        rows={[leagueRow('a'), leagueRow('b')]}
        showPeerGroup={false}
        selectedId={null}
        onSelect={() => undefined}
      />,
    );
    expect(hooks.trends).toHaveBeenCalledTimes(1);
    expect(hooks.trends).toHaveBeenCalledWith({ metric: 'index' });
    expect(text(markup)).toContain('Index trend, MODELLED');
    expect(markup).toContain('aria-label="Efficiency index at Depot a, MODELLED trend:');
    expect(markup).toContain('aria-label="Efficiency index at Depot b: no MODELLED trend yet"');
  });

  it('hides the column below the wide breakpoint with a display class, not the hidden attribute', () => {
    const markup = renderToStaticMarkup(
      <LeagueGrid
        rows={[leagueRow('a')]}
        showPeerGroup={false}
        selectedId={null}
        onSelect={() => undefined}
      />,
    );
    const header = markup.slice(0, markup.indexOf('Index trend, MODELLED'));
    expect(header.slice(header.lastIndexOf('<th'))).toContain('hidden lg:table-cell');
    const frame = document.createElement('div');
    frame.innerHTML = markup;
    expect(frame.querySelectorAll('[hidden]')).toHaveLength(0);
  });
});
