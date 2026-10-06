import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AvailabilityBar } from '@/components/depot/cockpit/AvailabilityBar';
import { LeagueGrid } from '@/components/depot/league/LeagueGrid';
import { KpiBand } from '@/components/depot/network/KpiBand';
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

  it('names the metric and tags the week MODELLED on its own line, with no LIVE tag on a figure', () => {
    const markup = renderToStaticMarkup(<KpiBand kpis={KPIS} depots={[]} />);
    const page = text(markup);
    expect(page).toMatch(/On-road share, MODELLED: (steady|up|down)[^]*over 7 days/);
    expect(page).toMatch(/Dark rate, MODELLED: (steady|up|down)[^]*over 7 days/);
    expect(markup.match(/data-testid="trend-week-line"/g)).toHaveLength(2);
    // Design wave: the page's DERIVED provenance line says live once; the trend line,
    // which differs from it, carries its own MODELLED tag, outside the figure band.
    expect(markup).not.toContain('data-provenance="live"');
    const trends = markup.slice(markup.indexOf('data-testid="depot-kpi-trends"'));
    expect(trends).toContain('data-provenance="modelled"');
    const band = markup.slice(0, markup.indexOf('data-testid="depot-kpi-trends"'));
    expect(band).not.toContain('trend-week-line');
  });

  it('prints nothing while the trend is loading', () => {
    hooks.forecast.mockReturnValue(polled(null, { loading: true }));
    expect(renderToStaticMarkup(<KpiBand kpis={KPIS} depots={[]} />)).not.toContain(
      'trend-week-line',
    );
  });
});

describe('cockpit availability bar', () => {
  it('puts the on-road share week beside the on-road figure, for this depot', () => {
    const segments = [
      { state: 'on_road' as const, label: 'On road', count: 6, share: 0.6, shareText: '60%' },
      { state: 'dark' as const, label: 'Dark', count: 4, share: 0.4, shareText: '40%' },
    ];
    const markup = renderToStaticMarkup(
      <AvailabilityBar fleet={10} segments={segments} text="Of 10 buses." yard={{ kind: 'no-yard', sentence: 'No yard.' }} yardHref="/y" howId="how" />,
    );
    expect(hooks.forecast).toHaveBeenCalledWith({
      metric: 'onRoadShare',
      scope: { kind: 'depot', depotId: '20' },
    });
    // Round 2 (critique, cockpit Must 3): the week line is the section label's note, its
    // tag in words once, and no longer inside the legend.
    const label = markup.slice(0, markup.indexOf('depot-availability-bar'));
    expect(text(label)).toMatch(/On-road share, MODELLED: .* over 7 days/);
    expect(text(markup).match(/MODELLED/g)).toHaveLength(1);
    const legend = markup.slice(markup.indexOf('Availability legend'));
    expect(legend).not.toMatch(/MODELLED/);
  });
});

describe('league grid', () => {
  it('fetches the index trends once for every row and tags the column MODELLED', () => {
    const index = { ...trendsResponse([trendRow('a', 2.1)]), metric: metricInfo('index') };
    hooks.trends.mockReturnValue(polled({ ...index, trendUnit: 'points' }));
    const markup = renderToStaticMarkup(
      <LeagueGrid
        rows={[leagueRow('a'), leagueRow('b')]}
        grouped={false}
        selectedId={null}
        onSelect={() => undefined}
        page={0}
        onPage={() => undefined}
      />,
    );
    expect(hooks.trends).toHaveBeenCalledTimes(1);
    expect(hooks.trends).toHaveBeenCalledWith({ metric: 'index' });
    expect(text(markup)).toMatch(/Trend\s*MODELLED/);
    expect(markup).toContain('aria-label="Efficiency index at Depot a, MODELLED trend:');
    expect(markup).toContain('aria-label="Efficiency index at Depot b: no MODELLED trend yet"');
  });

  it('hides the column below the wide breakpoint with a display class, not the hidden attribute', () => {
    const markup = renderToStaticMarkup(
      <LeagueGrid
        rows={[leagueRow('a')]}
        grouped={false}
        selectedId={null}
        onSelect={() => undefined}
        page={0}
        onPage={() => undefined}
      />,
    );
    const header = markup.slice(0, markup.indexOf('data-provenance="modelled"'));
    expect(header.slice(header.lastIndexOf('<th'))).toContain('hidden min-[1424px]:table-cell');
    const frame = document.createElement('div');
    frame.innerHTML = markup;
    expect(frame.querySelectorAll('[hidden]')).toHaveLength(0);
  });
});
