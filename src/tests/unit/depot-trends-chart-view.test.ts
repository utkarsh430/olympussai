import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { trendSummary } from '@/lib/depot/forecast/chartModel';
import { buildTrendsChartView, chartCaption } from '@/lib/depot/forecast/trendsChartView';
import { FOUR_WEEK_DAYS } from '@/lib/depot/forecast/trend';
import { forecastResponse } from './depot-trends-fixtures';

const FULL = forecastResponse('onRoadShare', 70);
const SHORT = forecastResponse('onRoadShare', 20);

describe('the Trends chart view', () => {
  it('words the legend in four plain words with the live point last, and no tag', () => {
    const view = buildTrendsChartView(FULL);
    expect(view.legend.map((entry) => entry.label)).toEqual([
      'History',
      'Forecast',
      '80% band',
      'Now (feed)',
    ]);
    expect(view.legend.map((entry) => entry.label).join(' ')).not.toContain('MODELLED');
  });

  it('keeps the history and the live point in the legend when there is no forecast', () => {
    const view = buildTrendsChartView(SHORT);
    expect(view.hasForecast).toBe(false);
    expect(view.legend.map((entry) => entry.label)).toEqual(['History', 'Now (feed)']);
  });

  it('names a forecast beside its band, in the legend, whenever a forecast is drawn', () => {
    const view = buildTrendsChartView(FULL);
    expect(view.hasForecast).toBe(true);
    expect(view.horizonDays).toBe(14);
    expect(view.legend.some((entry) => entry.key === 'band')).toBe(true);
  });

  it('puts no tag in the section label', () => {
    expect(buildTrendsChartView(FULL).label).toBe('On-road share: trend and forecast');
  });

  it('says MODELLED once in the text equivalent, and keeps the live value and the range', () => {
    const { summary } = buildTrendsChartView(FULL);
    expect(summary.match(/MODELLED/g)).toHaveLength(1);
    expect(summary).toContain('feed value');
    expect(summary).toMatch(/forecast to .* range /);
  });

  it('builds the text equivalent once with the word in its one place, never by repairing a string', () => {
    const { model, summary } = buildTrendsChartView(FULL);
    expect(summary).toBe(trendSummary(FULL, model.points, 'once'));
    expect(summary).toMatch(/^On-road share, MODELLED history from /);
    // The shared chart keeps the word on every generated part.
    expect(model.summary.match(/MODELLED/g)).toHaveLength(2);
    const source = readFileSync(
      join(process.cwd(), 'src/lib/depot/forecast/trendsChartView.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/\.replace\(\s*\/MODELLED/);
  });

  it('keeps the unavailable sentence in the text equivalent of a history without a forecast', () => {
    const { summary } = buildTrendsChartView(SHORT);
    expect(summary).toContain('No forecast: it needs at least 28 days of history');
    expect(summary.match(/MODELLED/g)).toHaveLength(1);
  });

  it('has one row per drawn point with its sort values', () => {
    const view = buildTrendsChartView(FULL);
    expect(view.table).toHaveLength(70 + 14);
    expect(view.table[69]?.kind).toBe('Now (feed)');
    // The Kind cell never carries the tag word.
    expect(view.table.some((r) => /MODELLED/.test(r.kind))).toBe(false);
    expect(view.table[70]?.sortLow).not.toBeNull();
  });
});

describe('the caption line', () => {
  it('reads the four-week trend, the week and the forecast error from the response', () => {
    const caption = chartCaption(FULL) ?? '';
    expect(caption).toMatch(
      /^(Steady|Up|Down)[^·]* over 4 weeks · [^·]* over 7 days · \d+-day forecast, (seasonal|Holt-Winters) method, within /,
    );
    expect(caption).toMatch(/pp a day ahead, [\d.]+ pp two weeks ahead$/);
    expect(caption.split(' · ')).toHaveLength(3);
  });

  it('drops the forecast piece when there is no forecast, and the trend pieces when there is no trend', () => {
    expect(chartCaption(SHORT)).not.toContain('forecast within');
    expect(chartCaption(forecastResponse('onRoadShare', 5))).toBeNull();
  });

  it('says a missing four-week trend in words', () => {
    const caption = chartCaption(forecastResponse('onRoadShare', 20)) ?? '';
    expect(caption.startsWith(`No trend over 4 weeks yet (20 of ${FOUR_WEEK_DAYS + 1} days) · `)).toBe(true);
  });
});
