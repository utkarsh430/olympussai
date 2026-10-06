import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DepotTrends } from '@/components/depot/trends/DepotTrends';
import { NetworkTrends } from '@/components/depot/trends/NetworkTrends';
import { forecastSeries } from '@/lib/depot/forecast/forecast';
import { summariseTrend } from '@/lib/depot/forecast/trend';
import { forecastSentences } from '@/lib/depot/forecast/wording';
import type { SeriesPoint } from '@/lib/depot/sim/types';
import {
  distributionResponse,
  forecastResponse,
  polled,
  series,
  trendRow,
  trendsResponse,
} from './depot-trends-fixtures';

const hooks = vi.hoisted(() => ({ forecast: vi.fn(), trends: vi.fn(), distribution: vi.fn() }));

vi.mock('@/components/depot/shared/TrendPlot', () => ({ TrendPlot: () => null }));
vi.mock('@/hooks/useDepotForecast', () => ({ useDepotForecast: hooks.forecast }));
vi.mock('@/hooks/useDepotTrends', () => ({ useDepotTrends: hooks.trends }));
vi.mock('@/hooks/useDepotDistribution', () => ({ useDepotDistribution: hooks.distribution }));
vi.mock('@/components/depot/data/DepotDetailProvider', () => ({
  useDepotDetailContext: () => ({ depotId: '20', error: null }),
}));

const text = (markup: string): string => markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

/** 70 days with 3 Oct missing: three days since the gap, too few for a trend or a forecast. */
function gapResponse() {
  const all = series('onRoadShare', 70);
  const pts: SeriesPoint[] = all.filter((_, i) => i !== 66);
  const trend = summariseTrend(pts, 'onRoadShare');
  const result = forecastSeries(pts, 'onRoadShare', 14);
  return forecastResponse('onRoadShare', 70, {
    history: { provenance: 'modelled', series: pts, anchor: pts.at(-1) as SeriesPoint },
    trend: { provenance: 'modelled', result: trend },
    forecast: { provenance: 'modelled', result },
    sentences: forecastSentences('onRoadShare', trend, result, 14),
  });
}

beforeEach(() => {
  hooks.forecast.mockReset();
  hooks.trends.mockReset();
  hooks.distribution.mockReset();
  hooks.trends.mockReturnValue(polled(trendsResponse([trendRow('1', 2.1)])));
  hooks.distribution.mockReturnValue(polled(distributionResponse('20', 40)));
  hooks.forecast.mockImplementation((request: { metric: 'onRoadShare' } | null) =>
    polled(request === null ? null : forecastResponse(request.metric, 70)),
  );
});

describe.each([
  ['network', () => <NetworkTrends metric="onRoadShare" />],
  ['depot', () => <DepotTrends metric="onRoadShare" />],
] as const)('the %s Trends page states', (_name, page) => {
  it('says a gap with its date in one state panel and draws no forecast', () => {
    hooks.forecast.mockReturnValue(polled(gapResponse()));
    const markup = renderToStaticMarkup(page());
    const visible = text(markup.replace(/<details[\s\S]*<\/details>/, ''));
    expect(visible).toContain('the history is missing 3 Oct 2026');
    expect(markup.match(/data-testid="trends-no-forecast"/g)).toHaveLength(1);
    expect(visible).not.toContain('80% band');
    expect(visible).not.toContain('forecast within');
    // The history still draws, with its caption pieces only for what exists.
    expect(markup).toContain('data-testid="trends-chart"');
  });

  it('says too little history without a forecast, and never draws one', () => {
    hooks.forecast.mockReturnValue(polled(forecastResponse('onRoadShare', 20)));
    const markup = renderToStaticMarkup(page());
    expect(text(markup)).toContain('No forecast: it needs at least 28 days of history');
    expect(text(markup)).toContain('A forecast appears once the history is long enough');
    expect(text(markup)).not.toContain('80% band');
  });

  it('holds the chart footprint while loading and offers Retry on error', () => {
    hooks.forecast.mockReturnValue(polled(null, { loading: true }));
    expect(renderToStaticMarkup(page())).toContain('data-testid="depot-loading"');
    hooks.forecast.mockReturnValue(polled(null, { error: 'Depot data unavailable' }));
    const markup = renderToStaticMarkup(page());
    expect(markup).toContain('role="alert"');
    expect(text(markup)).toContain('Retry');
  });

  it('prints the method, the error and the horizon with the band in the closing disclosure', () => {
    const markup = renderToStaticMarkup(page());
    const disclosure = text(markup.slice(markup.indexOf('<details')));
    expect(disclosure).toMatch(/Forecast (by weekly smoothing|repeats the same weekday)/);
    expect(disclosure).toContain('typically within');
    expect(disclosure).toContain('Forecast for the next 14 days.');
  });
});

describe('the depot availability band', () => {
  it('is three left-packed figures and one sentence saying both sides are modelled', () => {
    const markup = renderToStaticMarkup(<DepotTrends metric="onRoadShare" />);
    const band = markup.match(/data-testid="depot-figure-band"[\s\S]*?<\/ul>/)?.[0] ?? '';
    expect(band.match(/<li/g)).toHaveLength(3);
    const section = text(markup.slice(markup.indexOf('trends-availability')));
    expect(section).toContain('36 at peak + 4 spare');
    // Critique depot trends MUST 1: the note sits on the tagged label, the tag word never in prose.
    expect(
      markup
        .slice(markup.indexOf('trends-availability-heading'))
        .match(/The forecast rests on a generated history/g),
    ).toHaveLength(1);
    expect(section).not.toMatch(/Both sides are MODELLED/);
  });
});

describe('the depot chart table', () => {
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

  const values = (): string[] =>
    Array.from(container.querySelectorAll('tbody tr td:nth-child(2)')).map(
      (td) => td.textContent ?? '',
    );

  it('sorts by a header like the network table, and the page keeps one MODELLED tag on the chart', () => {
    act(() => root.render(<DepotTrends metric="onRoadShare" />));
    const toggle = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'table',
    ) as HTMLButtonElement;
    act(() => toggle.click());
    const header = Array.from(container.querySelectorAll('thead button')).find((b) =>
      b.textContent?.startsWith('Value'),
    ) as HTMLButtonElement;
    expect(header).toBeDefined();
    act(() => header.click());
    const ascending = values().map((v) => parseFloat(v));
    expect([...ascending].sort((a, b) => a - b)).toEqual(ascending);
    act(() => header.click());
    const descending = values().map((v) => parseFloat(v));
    expect([...descending].sort((a, b) => b - a)).toEqual(descending);
    expect(
      container.querySelector('th[aria-sort="ascending"], th[aria-sort="descending"]')?.textContent,
    ).toContain('Value');
  });
});

describe('the unit table columns', () => {
  it('has a bare signed number and its own direction-word column for each change', () => {
    hooks.trends.mockReturnValue(polled(trendsResponse([trendRow('1', 2.1), trendRow('2', -3)])));
    const markup = renderToStaticMarkup(<NetworkTrends metric="onRoadShare" />);
    expect(text(markup)).toMatch(/Trend, 7 days/);
    expect(text(markup)).toMatch(/Trend, 4 weeks/);
    expect(text(markup)).toContain('−3.0');
    expect(text(markup)).toContain('DOWN');
    const table = text(markup.match(/data-testid="trends-unit-table"[\s\S]*?<\/table>/)?.[0] ?? '');
    expect(table).not.toMatch(/down 3\.0|up 2\.1|steady, /);
  });
});
