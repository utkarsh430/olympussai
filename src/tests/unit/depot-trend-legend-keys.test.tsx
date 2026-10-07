import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LegendKey } from '@/components/depot/trendChart/TrendChartParts';
import { TREND_COLOUR } from '@/components/depot/trendChart/trendStyle';

describe('the trend legend keys', () => {
  it('draws the forecast line and its band in the forecast colour the chart uses', () => {
    const dashed = renderToStaticMarkup(<LegendKey mark="dashed" />);
    const area = renderToStaticMarkup(<LegendKey mark="area" />);
    expect(dashed).toContain(`stroke="${TREND_COLOUR.forecast}"`);
    expect(area).toContain(`fill="${TREND_COLOUR.forecast}"`);
  });

  it('draws the history line in the history colour', () => {
    expect(renderToStaticMarkup(<LegendKey mark="line" />)).toContain(
      `stroke="${TREND_COLOUR.history}"`,
    );
  });
});
