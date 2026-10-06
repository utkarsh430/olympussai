import { act, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SeriesPoint } from '@/lib/depot/sim/types';
import { forecastSections } from '@/lib/depot/live/forecastView';
import { metricInfo } from '@/lib/depot/forecast/wording';
import { buildTrendChartModel } from '@/lib/depot/forecast/chartModel';
import { TrendPlot } from '@/components/depot/trendChart/TrendPlot';

// jsdom lays every container out at 0 x 0, so ResponsiveContainer would draw
// nothing. Give the chart a fixed size instead; layout itself needs a browser.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) =>
      isValidElement(children)
        ? cloneElement(children as ReactElement<{ width: number; height: number }>, {
            width: 640,
            height: 240,
          })
        : null,
  };
});

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

const series: SeriesPoint[] = Array.from({ length: 60 }, (_, i) => ({
  date: new Date(Date.UTC(2026, 7, 8) + i * 86_400_000).toISOString().slice(0, 10),
  value: 0.6 + 0.04 * Math.sin(i),
}));

describe('TrendPlot', () => {
  it('draws a dashed forecast, the LIVE label, the now marker and 11px ticks', () => {
    const model = buildTrendChartModel({
      metric: metricInfo('onRoadShare'),
      horizonDays: 14,
      history: { provenance: 'modelled', series, anchor: { date: '2026-10-06', value: 0.6 } },
      ...forecastSections(series, 'onRoadShare', 14),
    });
    act(() => root.render(<TrendPlot model={model} unit="fraction" height={240} />));
    const text = container.textContent ?? '';
    expect(text).toContain('LIVE');
    expect(text).toContain('Now');
    expect(text).toMatch(/\d+%/);
    expect(container.querySelector('path[stroke-dasharray="6 4"]')).not.toBeNull();
    const sizes = [...container.querySelectorAll('text[font-size]')].map((t) =>
      Number(t.getAttribute('font-size')),
    );
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(11);
  });
});
