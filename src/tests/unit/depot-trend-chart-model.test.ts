// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { MetricKey, SeriesPoint } from '@/lib/depot/sim/types';
import type { ForecastResult } from '@/lib/depot/forecast/types';
import { forecastSections } from '@/lib/depot/live/forecastView';
import { metricInfo } from '@/lib/depot/forecast/wording';
import { formatDate, formatValue, valueScale } from '@/lib/depot/forecast/chartScale';
import { buildTrendChartModel, type TrendChartInput } from '@/lib/depot/forecast/chartModel';
import { sparklineGeometry, sparklineLabel } from '@/lib/depot/forecast/sparklineModel';

function dailySeries(length: number, value: (i: number) => number): SeriesPoint[] {
  const end = Date.UTC(2026, 9, 6);
  return Array.from({ length }, (_, i) => ({
    date: new Date(end - (length - 1 - i) * 86_400_000).toISOString().slice(0, 10),
    value: value(i),
  }));
}

function inputFor(metric: MetricKey, series: readonly SeriesPoint[], horizon = 14): TrendChartInput {
  const last = series.at(-1) ?? { date: '2026-10-06', value: 0 };
  return {
    metric: metricInfo(metric),
    horizonDays: horizon,
    history: { provenance: 'modelled', series, anchor: last },
    ...forecastSections(series, metric, horizon),
  };
}

const rhythm = (i: number): number => 0.6 + 0.05 * Math.sin((2 * Math.PI * i) / 7);
const finite = (values: readonly number[]): boolean => values.every(Number.isFinite);

describe('valueScale', () => {
  it('stops at the top of a rate and never ticks beyond it', () => {
    const scale = valueScale([0.95, 0.99, 1], metricInfo('onRoadShare').range, 'rate');
    expect(scale.domain[1]).toBe(1);
    expect(scale.ticks.at(-1)).toBeLessThanOrEqual(1);
    expect(scale.ticks.every((t) => t >= scale.domain[0] && t <= 1)).toBe(true);
  });

  it('stops at zero for a rate near the floor', () => {
    const scale = valueScale([0, 0.01, 0.04], metricInfo('darkRate').range, 'rate');
    expect(scale.domain[0]).toBe(0);
    expect(scale.ticks[0]).toBe(0);
  });

  it('gives a constant series a real span with finite ticks', () => {
    const scale = valueScale([0.5, 0.5, 0.5], metricInfo('onRoadShare').range, 'rate');
    expect(scale.domain[0]).toBeLessThan(0.5);
    expect(scale.domain[1]).toBeGreaterThan(0.5);
    expect(finite(scale.ticks)).toBe(true);
    expect(scale.ticks.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps a constant zero count off negative values and ticks whole buses', () => {
    const scale = valueScale([0, 0], metricInfo('available').range, 'count');
    expect(scale.domain[0]).toBe(0);
    expect(scale.domain[1]).toBeGreaterThan(0);
    expect(scale.ticks.every(Number.isInteger)).toBe(true);
  });

  it('falls back to a defined domain for no values at all', () => {
    const scale = valueScale([], metricInfo('index').range, 'index');
    expect(finite([...scale.domain, ...scale.ticks])).toBe(true);
    expect(scale.domain[0]).toBeGreaterThanOrEqual(0);
  });
});

describe('formatting', () => {
  it('states each unit as a page shows it', () => {
    expect(formatValue(0.6234, 'fraction')).toBe('62.3%');
    expect(formatValue(71.25, 'points')).toBe('71.3');
    expect(formatValue(412.4, 'buses')).toBe('412');
    expect(formatDate('2026-10-06')).toBe('6 Oct');
    expect(formatDate('2026-01-31', true)).toBe('31 Jan 2026');
  });
});

describe('buildTrendChartModel', () => {
  it('marks the last history point LIVE and the forecast after it', () => {
    const model = buildTrendChartModel(inputFor('onRoadShare', dailySeries(90, rhythm)));
    const kinds = model.points.map((p) => p.kind);
    expect(kinds.filter((k) => k === 'history')).toHaveLength(89);
    expect(kinds[89]).toBe('live');
    expect(kinds.slice(90).every((k) => k === 'forecast')).toBe(true);
    expect(model.points).toHaveLength(104);
    expect(model.now?.date).toBe('2026-10-06');
    expect(model.xTicks).toContain('2026-10-06');
    expect(model.xTicks.length).toBeLessThanOrEqual(7);
  });

  it('starts the dashed forecast and its band on the live point', () => {
    const model = buildTrendChartModel(inputFor('onRoadShare', dailySeries(90, rhythm)));
    const liveRow = model.rows.find((r) => r.date === '2026-10-06');
    expect(liveRow?.live).toBe(liveRow?.history);
    expect(liveRow?.forecast).toBe(liveRow?.live);
    expect(liveRow?.band).toEqual([liveRow?.live, liveRow?.live]);
  });

  it('carries MODELLED in the title, the history and forecast legend entries', () => {
    const model = buildTrendChartModel(inputFor('index', dailySeries(60, (i) => 70 + (i % 7))));
    expect(model.title).toBe('Efficiency index: trend and forecast, MODELLED');
    expect(model.legend.map((e) => e.label)).toEqual([
      'History, MODELLED',
      'Live value, LIVE',
      'Forecast, MODELLED',
      'Forecast range (80% of past errors), MODELLED',
    ]);
    expect(model.points[0]?.description).toBe('MODELLED history');
    expect(model.now?.description).toBe('LIVE value');
    expect(model.points.at(-1)?.description).toMatch(/^MODELLED forecast, range \d+\.\d to \d+\.\d$/);
  });

  it('draws only the history and says why when there is no forecast', () => {
    const model = buildTrendChartModel(inputFor('darkRate', dailySeries(20, () => 0.1)));
    expect(model.points.some((p) => p.kind === 'forecast')).toBe(false);
    expect(model.legend.map((e) => e.key)).toEqual(['history', 'live']);
    expect(model.notes).toContain(
      'No forecast: it needs at least 28 days of history and this series has 20.',
    );
    expect(model.summary).toContain('No forecast');
  });

  it('draws a single point without a NaN anywhere', () => {
    const model = buildTrendChartModel(inputFor('available', dailySeries(1, () => 42)));
    expect(model.points).toEqual([
      expect.objectContaining({ kind: 'live', value: 42, low: null, high: null }),
    ]);
    expect(finite([...model.yScale.domain, ...model.yScale.ticks])).toBe(true);
  });

  it('clips a band that leaves the valid range', () => {
    const base = inputFor('onRoadShare', dailySeries(30, () => 0.97));
    const result: ForecastResult = {
      status: 'ok',
      forecast: {
        method: 'seasonal_naive',
        reason: 'short_history',
        horizonDays: 1,
        points: [{ date: '2026-10-07', value: 0.99, low: 0.9, high: 1.08 }],
        backtestMae: 0.01,
        backtestDays: 2,
        seasonalNaiveMae: 0.01,
        holtWintersMae: null,
        historyDays: 30,
      },
    };
    const model = buildTrendChartModel({ ...base, forecast: { provenance: 'modelled', result } });
    expect(model.points.at(-1)).toMatchObject({ value: 0.99, low: 0.9, high: 1 });
    expect(model.rows.at(-1)?.band).toEqual([0.9, 1]);
    expect(model.yScale.domain[1]).toBe(1);
  });

  it('lists the same points in the table as it draws', () => {
    const model = buildTrendChartModel(inputFor('onRoadShare', dailySeries(40, rhythm), 7));
    expect(model.table).toHaveLength(model.points.length);
    model.table.forEach((row, i) => {
      const point = model.points[i];
      expect(row.date).toBe(formatDate(point?.date ?? '', true));
      expect(row.value).toBe(formatValue(point?.value ?? NaN, 'fraction'));
    });
    expect(model.table[0]).toMatchObject({ kind: 'MODELLED history', low: '', high: '' });
    expect(model.table[39]?.kind).toBe('LIVE value');
    expect(model.table.at(-1)?.kind).toBe('MODELLED forecast');
    expect(model.table.at(-1)?.low).toMatch(/%$/);
  });
});

describe('sparkline', () => {
  it('draws a line ending on a distinct live point inside the box', () => {
    const geometry = sparklineGeometry([1, 3, 2, 5], 96, 24);
    expect(geometry.kind).toBe('line');
    if (geometry.kind !== 'line') return;
    expect(geometry.path.startsWith('M')).toBe(true);
    expect(geometry.path).not.toContain('NaN');
    expect(geometry.live.x).toBeCloseTo(96 - geometry.inset);
    expect(geometry.live.y).toBeCloseTo(geometry.inset);
  });

  it('draws a flat series as a level line, never dividing by zero', () => {
    const geometry = sparklineGeometry([4, 4, 4], 96, 24);
    expect(geometry).toMatchObject({ kind: 'line', flat: true, live: { y: 12 } });
  });

  it('returns the placeholder for an empty or one-point series', () => {
    expect(sparklineGeometry([], 96, 24)).toEqual({ kind: 'empty' });
    expect(sparklineGeometry([3], 96, 24)).toEqual({ kind: 'empty' });
    expect(sparklineGeometry([1, Number.NaN], 96, 24)).toEqual({ kind: 'empty' });
  });

  it('labels itself from the trend summary sentence', () => {
    const { trend } = forecastSections(dailySeries(40, (i) => 50 + i * 0.2), 'index', 14);
    expect(sparklineLabel('Efficiency index', trend.result)).toBe(
      'Efficiency index, MODELLED trend: up 6.0 points over 30 days, ending on the live value',
    );
    const short = forecastSections(dailySeries(5, () => 50), 'index', 14).trend.result;
    expect(sparklineLabel('Efficiency index', short)).toBe('Efficiency index: no trend yet');
  });
});
