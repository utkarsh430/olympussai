import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DepotTrends } from '@/components/depot/trends/DepotTrends';
import { NetworkTrends } from '@/components/depot/trends/NetworkTrends';
import { TREND_ROW_CAP } from '@/lib/depot/forecast/trendsTableModel';
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
  detail: { depotId: '20', error: null as string | null },
}));

vi.mock('@/components/depot/shared/TrendPlot', () => ({ TrendPlot: () => null }));
vi.mock('@/hooks/useDepotForecast', () => ({ useDepotForecast: hooks.forecast }));
vi.mock('@/hooks/useDepotTrends', () => ({ useDepotTrends: hooks.trends }));
vi.mock('@/hooks/useDepotDistribution', () => ({ useDepotDistribution: hooks.distribution }));
vi.mock('@/components/depot/data/DepotDetailProvider', () => ({
  useDepotDetailContext: () => hooks.detail,
}));

const text = (markup: string): string => markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

beforeEach(() => {
  hooks.forecast.mockReset();
  hooks.trends.mockReset();
  hooks.distribution.mockReset();
  hooks.detail = { depotId: '20', error: null };
  hooks.forecast.mockImplementation((request: { metric: 'onRoadShare' } | null) =>
    polled(request === null ? null : forecastResponse(request.metric, 70)),
  );
  hooks.trends.mockReturnValue(polled(trendsResponse([trendRow('1', 2.1), trendRow('2', -3)])));
  hooks.distribution.mockReturnValue(polled(distributionResponse('20', 40)));
});

describe('network Trends page', () => {
  it('asks for one forecast and one batch of trends, never a request per row', () => {
    renderToStaticMarkup(<NetworkTrends metric="index" />);
    expect(hooks.forecast).toHaveBeenCalledWith({ metric: 'index', scope: { kind: 'network' } });
    expect(hooks.trends).toHaveBeenCalledWith({ metric: 'index' });
    expect(hooks.forecast).toHaveBeenCalledTimes(1);
    expect(hooks.trends).toHaveBeenCalledTimes(1);
  });

  it('marks the chosen measure and links every other one', () => {
    const markup = renderToStaticMarkup(<NetworkTrends metric="darkRate" />);
    expect(markup).toMatch(
      /aria-current="page"[^>]*href="\/project\/depots\/trends\?metric=darkRate"/,
    );
    expect(markup).toContain('href="/project/depots/trends?metric=index"');
    expect(markup.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it('says once that the history is generated and tags only the chart and the unit list', () => {
    const markup = renderToStaticMarkup(<NetworkTrends metric="onRoadShare" />);
    const page = text(markup);
    // The sentence lives in the closed disclosure; the provenance line is the header's.
    expect(page.match(/generated until a database of real history exists/g)).toHaveLength(1);
    expect(markup).toContain('How these figures are produced');
    // Rewritten for the round-2 decisions: the tag moved from the title text to the section
    // label's pill, and the sentences under the chart became one caption line (below).
    expect(page).toContain('On-road share: trend and forecast');
    expect(page).not.toContain('trend and forecast, MODELLED');
    expect(page).toContain('Every unit');
    expect(page).not.toContain('Every unit, MODELLED');
    expect(page).toContain('Trends of on-road share: all 2 units');
    // Visible page only (the closed disclosure removed): the chart's tag and the list's tag.
    const visible = text(markup.replace(/<details[\s\S]*<\/details>/, ''));
    expect(visible.match(/MODELLED/g)).toHaveLength(2);
    expect(visible).toMatch(/On-road share: trend and forecast\s+MODELLED/);
    expect(visible).toMatch(/Every unit · 2\s+MODELLED/);
    // No tag in the table's headers or caption.
    expect(markup.match(/<th[^>]*>[^<]*MODELLED/g)).toBeNull();
    expect(page.toLowerCase()).not.toContain('simulated');
  });

  it('prints one caption line and the legend in four plain words under the chart', () => {
    const markup = renderToStaticMarkup(<NetworkTrends metric="onRoadShare" />);
    const page = text(markup);
    for (const label of ['History', 'Forecast', '80% band', 'Now (live)']) {
      expect(page).toContain(label);
    }
    expect(page).not.toMatch(/Forecast, MODELLED|History, MODELLED|Live value, LIVE/);
    const caption = markup.match(/data-testid="trends-caption"[^>]*>([^<]*)</)?.[1] ?? '';
    expect(caption).toMatch(/ over 4 weeks · .* over 7 days · forecast within /);
    // The 4-week trend is said once in the caption, and no "Trend:" sentence stands beside it.
    expect(caption.match(/over 4 weeks/g)).toHaveLength(1);
    expect(page.match(/Trend: [a-z0-9. ]+ over (7 days|4 weeks)/g)).toBeNull();
  });

  it('says MODELLED once in the text equivalent and keeps the live value in it', () => {
    const markup = renderToStaticMarkup(<NetworkTrends metric="onRoadShare" />);
    const label = markup.match(/role="img" aria-label="([^"]*)"/)?.[1] ?? '';
    expect(label.match(/MODELLED/g)).toHaveLength(1);
    expect(label).toContain('LIVE value');
  });

  it('never shows a forecast without its band, its horizon, its method and its error in words', () => {
    const markup = renderToStaticMarkup(<NetworkTrends metric="onRoadShare" />);
    const page = text(markup);
    expect(page).toContain('80% band');
    expect(page).toContain('Forecast for the next 14 days.');
    expect(page).toMatch(/Forecast by weekly smoothing|Forecast repeats the same weekday/);
    expect(page).toContain('typically within');
    expect(markup).toMatch(/data-testid="trends-caption"[^>]*>[^<]*forecast within/);
  });

  it('links each unit to its own Trends page with a text equivalent for its sparkline', () => {
    const markup = renderToStaticMarkup(<NetworkTrends metric="onRoadShare" />);
    expect(markup).toContain('href="/project/depots/d/2/trends?metric=onRoadShare"');
    expect(markup).toContain('aria-label="On-road share at Depot 2, MODELLED trend:');
  });

  it('shows the history and says why when there is too little for a forecast', () => {
    hooks.forecast.mockReturnValue(polled(forecastResponse('onRoadShare', 20)));
    const page = text(renderToStaticMarkup(<NetworkTrends metric="onRoadShare" />));
    expect(page).toContain(
      'No forecast: it needs at least 28 days of history and this series has 20.',
    );
    // 20 days is enough for a trend; the one state panel says the forecast is missing, and
    // no forecast is drawn: no band in the legend, no horizon, no error in the caption.
    expect(page).not.toContain('No trend yet');
    expect(page).not.toContain('80% band');
    expect(page).not.toContain('forecast within');
    expect(page).not.toContain('Forecast for the next');
  });

  it('holds the footprint while loading, and offers Retry with a title on failure', () => {
    hooks.forecast.mockReturnValue(polled(null, { loading: true }));
    hooks.trends.mockReturnValue(polled(null, { loading: true }));
    expect(renderToStaticMarkup(<NetworkTrends metric="onRoadShare" />)).toContain(
      'data-testid="depot-loading"',
    );
    hooks.forecast.mockReturnValue(polled(null, { error: 'Depot data unavailable' }));
    hooks.trends.mockReturnValue(polled(null, { error: 'Depot data unavailable' }));
    const page = text(renderToStaticMarkup(<NetworkTrends metric="onRoadShare" />));
    expect(page).toContain('Could not load the network trend');
    expect(page).toContain('Could not load the unit trends');
    expect(page).toContain('Retry');
  });

  it('shows the stale strip when a poll fails after a good response', () => {
    hooks.trends.mockReturnValue(
      polled(trendsResponse([trendRow('1', 1)]), { error: 'Could not reach the server' }),
    );
    expect(renderToStaticMarkup(<NetworkTrends metric="onRoadShare" />)).toContain(
      'data-testid="depot-stale"',
    );
  });
});

describe('the unit table', () => {
  let container: HTMLDivElement;
  let root: Root;
  const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };

  beforeEach(() => {
    actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const names = (): string[] =>
    Array.from(container.querySelectorAll('tbody tr td:first-child')).map(
      (td) => td.textContent ?? '',
    );

  it('starts worst first, re-sorts on the header button, and pages the rows', () => {
    const units = Array.from({ length: TREND_ROW_CAP + 2 }, (_, i) => trendRow(String(i), i - 5));
    hooks.trends.mockReturnValue(polled(trendsResponse(units)));
    act(() => root.render(<NetworkTrends metric="onRoadShare" />));
    expect(names()).toHaveLength(TREND_ROW_CAP);
    expect(names()[0]).toBe('Depot 0');
    const fourWeeks = Array.from(container.querySelectorAll('thead button')).find((b) =>
      b.textContent?.startsWith('Over 4 weeks'),
    );
    act(() => (fourWeeks as HTMLButtonElement).click());
    expect(names()[0]).toBe('Depot 26');
    // The shared pager replaced "Show all N" (rulings: a page whose purpose is the list pages at 25).
    expect(container.querySelector('[data-testid="depot-pager"] [role="status"]')?.textContent).toBe(
      `Rows 1 to ${TREND_ROW_CAP} of ${TREND_ROW_CAP + 2}`,
    );
    const next = Array.from(container.querySelectorAll('[data-testid="depot-pager"] button')).find(
      (b) => b.textContent === 'Next',
    ) as HTMLButtonElement;
    act(() => next.click());
    expect(names()).toHaveLength(2);
  });
});

describe('depot Trends page', () => {
  it('draws the chosen measure and the availability forecast, sharing it when chosen', () => {
    renderToStaticMarkup(<DepotTrends metric="index" />);
    const scope = { kind: 'depot', depotId: '20' };
    expect(hooks.forecast).toHaveBeenCalledWith({ metric: 'index', scope });
    expect(hooks.forecast).toHaveBeenCalledWith({ metric: 'available', scope });
    hooks.forecast.mockClear();
    renderToStaticMarkup(<DepotTrends metric="available" />);
    expect(hooks.forecast).toHaveBeenCalledWith({ metric: 'available', scope });
    expect(hooks.forecast).toHaveBeenCalledWith(null);
  });

  it('sets available buses beside the modelled requirement and says both are modelled', () => {
    const page = text(renderToStaticMarkup(<DepotTrends metric="onRoadShare" />));
    expect(page).toContain('Available buses against the requirement');
    expect(page).not.toContain('requirement, MODELLED');
    // The longer comparison sentence is the band's title, not a second paragraph.
    expect(renderToStaticMarkup(<DepotTrends metric="onRoadShare" />)).toContain(
      'modelled requirement of 40 (36 at peak plus 4 spare)',
    );
    expect(page).toContain('Both sides are MODELLED');
    expect(page).toContain('Requirement');
    expect(page).toContain('Days below the requirement');
  });

  it('links the measures to this depot', () => {
    const markup = renderToStaticMarkup(<DepotTrends metric="onRoadShare" />);
    expect(markup).toContain('href="/project/depots/d/20/trends?metric=index"');
  });

  it('says a well-formed id is not in the feed, with a way back', () => {
    hooks.detail = { depotId: '20', error: 'Depot not found' };
    const markup = renderToStaticMarkup(<DepotTrends metric="onRoadShare" />);
    expect(text(markup)).toContain('No depot has the id 20 in the current feed.');
    expect(markup).toContain('href="/project/depots"');
  });
});
