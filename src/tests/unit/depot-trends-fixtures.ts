/**
 * Responses for the Trends page render tests, built with the real forecast
 * and wording functions so the pages are tested against true shapes.
 */
import type { DepotForecastResponse, DepotTrendsResponse, TrendRow } from '@/lib/depot/forecast/api';
import { forecastSeries } from '@/lib/depot/forecast/forecast';
import { summariseTrend } from '@/lib/depot/forecast/trend';
import { forecastSentences, metricInfo } from '@/lib/depot/forecast/wording';
import type { DepotDistributionResponse } from '@/lib/depot/api';
import type { MetricKey, SeriesPoint } from '@/lib/depot/sim/types';
import type { PolledState } from '@/hooks/usePolledJson';

const END = Date.UTC(2026, 9, 6);
const DAY_MS = 86_400_000;
const WEEKLY = [0, 0.01, 0.02, 0.01, 0, -0.01, -0.02];

export function series(metric: MetricKey, days: number): SeriesPoint[] {
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(END - (days - 1 - i) * DAY_MS).toISOString().slice(0, 10);
    // A fixed pseudo-noise, so the backtest has errors to report.
    const wobble = (WEEKLY[i % WEEKLY.length] ?? 0) + (((i * 37) % 11) - 5) / 1000;
    const value = metric === 'available' ? 44 + Math.round(wobble * 200) : 0.8 + wobble;
    return { date, value };
  });
}

const ENVELOPE = {
  feedNow: '2026-10-06T08:00:00.000Z',
  fetchedAt: '2026-10-06T08:00:05.000Z',
  source: 'fixture',
  stale: false,
} as const;

export function forecastResponse(
  metric: MetricKey,
  days: number,
  overrides: Partial<DepotForecastResponse> = {},
): DepotForecastResponse {
  const points = series(metric, days);
  const trend = summariseTrend(points, metric);
  const result = forecastSeries(points, metric, 14);
  return {
    ...ENVELOPE,
    metric: metricInfo(metric),
    scope: { kind: 'network' },
    horizonDays: 14,
    history: { provenance: 'modelled', series: points, anchor: points.at(-1) as SeriesPoint },
    trend: { provenance: 'modelled', result: trend },
    forecast: { provenance: 'modelled', result },
    sentences: forecastSentences(metric, trend, result, 14),
    ...overrides,
  } as DepotForecastResponse;
}

export function trendRow(id: string, fourWeeks: number | null): TrendRow {
  return {
    id,
    name: `Depot ${id}`,
    endDate: '2026-10-06',
    values: [0.8, 0.81, 0.82],
    trend: {
      direction: fourWeeks === null || fourWeeks === 0 ? 'steady' : fourWeeks > 0 ? 'up' : 'down',
      week: 0.4,
      fourWeeks,
      sentence: 'MODELLED trend: steady over 4 weeks',
    },
  };
}

export function trendsResponse(units: readonly TrendRow[]): DepotTrendsResponse {
  return {
    ...ENVELOPE,
    provenance: 'modelled',
    metric: metricInfo('onRoadShare'),
    trendUnit: 'percentage_points',
    days: 30,
    network: trendRow('network', 1),
    units,
  } as DepotTrendsResponse;
}

export function distributionResponse(depotId: string, required: number): DepotDistributionResponse {
  return {
    ...ENVELOPE,
    balances: [
      { depotId, required, peakRequirement: required - 4, spareTarget: 4 },
    ],
  } as unknown as DepotDistributionResponse;
}

export function polled<T>(data: T | null, extra: Partial<PolledState<T>> = {}): PolledState<T> {
  return { data, error: null, loading: false, refresh: () => undefined, ...extra };
}
