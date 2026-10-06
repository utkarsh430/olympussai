import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MetricKey, SeriesPoint } from '@/lib/depot/sim/types';
import { forecastSections } from '@/lib/depot/live/forecastView';
import { metricInfo } from '@/lib/depot/forecast/wording';
import type { TrendChartInput } from '@/lib/depot/forecast/chartModel';
import { Sparkline } from '@/components/depot/shared/Sparkline';
import { TrendChart } from '@/components/depot/shared/TrendChart';

// Recharts measures its container, which jsdom lays out at 0 x 0. The plot is
// stubbed so these tests cover what the component owns: text, legend, table.
vi.mock('@/components/depot/shared/TrendPlot', () => ({
  TrendPlot: () => <div data-testid="trend-plot-stub" />,
}));

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
const originalActFlag = actGlobal.IS_REACT_ACT_ENVIRONMENT;
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  actGlobal.IS_REACT_ACT_ENVIRONMENT = originalActFlag;
});

function dailySeries(length: number, value: (i: number) => number): SeriesPoint[] {
  const end = Date.UTC(2026, 9, 6);
  return Array.from({ length }, (_, i) => ({
    date: new Date(end - (length - 1 - i) * 86_400_000).toISOString().slice(0, 10),
    value: value(i),
  }));
}

function inputFor(metric: MetricKey, series: readonly SeriesPoint[]): TrendChartInput {
  const last = series.at(-1) ?? { date: '2026-10-06', value: 0 };
  return {
    metric: metricInfo(metric),
    horizonDays: 14,
    history: { provenance: 'modelled', series, anchor: last },
    ...forecastSections(series, metric, 14),
  };
}

const render = (node: React.ReactNode): void => act(() => root.render(node));
const text = (): string => container.textContent ?? '';

describe('Sparkline', () => {
  it('is a labelled image with nothing interactive inside', () => {
    render(<Sparkline values={[1, 3, 2, 5]} label="On-road share, MODELLED trend: up" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toBe('On-road share, MODELLED trend: up');
    expect(container.querySelectorAll('button, a, [tabindex]')).toHaveLength(0);
    expect(container.querySelector('[data-mark="live"]')).not.toBeNull();
    expect(container.querySelector('[data-mark="history"]')).not.toBeNull();
    expect(container.textContent).toBe('MODELLED');
  });

  it('leaves the tag to the column header when told to', () => {
    render(<Sparkline values={[1, 2]} label="Dark rate, MODELLED trend" tagged={false} />);
    expect(container.textContent).toBe('');
    expect(container.firstElementChild?.tagName.toLowerCase()).toBe('svg');
  });

  it('renders the placeholder for an empty series', () => {
    render(<Sparkline values={[]} label="Dark rate: no trend yet" />);
    const placeholder = container.querySelector('[data-testid="sparkline-placeholder"]');
    expect(placeholder?.getAttribute('aria-label')).toBe('Dark rate: no trend yet');
    expect(container.querySelector('path')).toBeNull();
  });
});

describe('TrendChart', () => {
  const sample = (): TrendChartInput =>
    inputFor(
      'onRoadShare',
      dailySeries(90, (i) => 0.6 + 0.05 * Math.sin(i)),
    );

  it('titles the chart and words its legend with MODELLED and LIVE', () => {
    render(<TrendChart data={sample()} />);
    const heading = container.querySelector('h3');
    expect(heading?.textContent).toBe('On-road share: trend and forecast, MODELLED');
    const legend = [...container.querySelectorAll('[data-legend]')].map((e) => e.textContent);
    expect(legend).toEqual([
      'History, MODELLED',
      'Live value, LIVE',
      'Forecast, MODELLED',
      'Forecast range (80% of past errors at each day ahead), MODELLED',
    ]);
    expect(text()).toContain('MODELLED: typically within');
    expect(text()).toContain('Forecast for the next 14 days.');
    expect(text().toLowerCase()).not.toContain('simulated');
  });

  it('swaps the chart for a table of the same points and back', () => {
    render(<TrendChart data={sample()} headingLevel={2} />);
    const button = container.querySelector('button');
    expect(button?.textContent).toBe('Show as table');
    expect(button?.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('[data-testid="trend-plot-stub"]')).not.toBeNull();
    expect(container.querySelector('table')).toBeNull();

    const controlled = button?.getAttribute('aria-controls') ?? '';
    expect(controlled).not.toBe('');
    expect(container.querySelector(`[id="${controlled}"]`)).not.toBeNull();
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toBe('');
    act(() => button?.click());
    expect(button?.getAttribute('aria-pressed')).toBe('true');
    expect(status?.textContent).toBe('Showing the values as a table.');
    expect(container.querySelector(`[id="${controlled}"] table`)).not.toBeNull();
    expect(container.querySelector('[data-testid="trend-plot-stub"]')).toBeNull();
    const headers = [...container.querySelectorAll('th')].map((th) => th.textContent);
    expect(headers).toEqual(['Date', 'Value', 'Low', 'High', 'Kind']);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(104);
    expect(container.querySelector('caption')?.textContent).toContain('MODELLED');

    act(() => button?.click());
    expect(container.querySelector('table')).toBeNull();
  });

  it('gives the plot region a text equivalent', () => {
    render(<TrendChart data={sample()} />);
    const figure = container.querySelector('[role="img"]');
    expect(figure?.getAttribute('aria-label')).toMatch(/^On-road share, MODELLED history from/);
  });

  it('draws the history and says why when there is no forecast', () => {
    render(
      <TrendChart
        data={inputFor(
          'darkRate',
          dailySeries(20, () => 0.1),
        )}
      />,
    );
    expect(text()).toContain(
      'No forecast: it needs at least 28 days of history and this series has 20.',
    );
    const legend = [...container.querySelectorAll('[data-legend]')].map((e) => e.textContent);
    expect(legend).toEqual(['History, MODELLED', 'Live value, LIVE']);
  });
});
