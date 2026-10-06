import { describe, expect, it } from 'vitest';
import type { TrendChange, TrendResult } from '@/lib/depot/forecast/trend';
import {
  DEFAULT_TREND_METRIC,
  depotTrendsPath,
  metricOptions,
  MODELLED_HISTORY_NOTE,
  NETWORK_TRENDS_PATH,
  parseTrendMetric,
  trendLines,
  trendsHref,
} from '@/lib/depot/forecast/trendsPageModel';
import {
  COCKPIT_TREND_METRIC,
  KPI_TREND_METRIC,
  weekTrendLine,
} from '@/lib/depot/forecast/trendMounts';

function change(days: number, value: number, sentence: string): TrendChange {
  return {
    days,
    from: { date: '2026-09-01', value: 0.8 },
    change: value,
    steadyWithin: 0.5,
    direction: sentence.startsWith('up') ? 'up' : sentence.startsWith('down') ? 'down' : 'steady',
    sentence,
  };
}

function okTrend(week: TrendChange, fourWeeks: TrendChange | null): TrendResult {
  return {
    status: 'ok',
    summary: {
      metric: 'onRoadShare',
      kind: 'rate',
      unit: 'percentage_points',
      higherIsBetter: true,
      latest: { date: '2026-10-06', value: 0.82 },
      week,
      fourWeeks,
      sentence: (fourWeeks ?? week).sentence,
      historyDays: 90,
    },
  };
}

describe('the metric in the URL', () => {
  it('offers every metric the history has, with the forecast module labels and units', () => {
    const options = metricOptions();
    expect(options.map((o) => o.key)).toEqual([
      'onRoadShare',
      'offRoadRate',
      'darkRate',
      'index',
      'available',
    ]);
    expect(options[0]).toEqual({
      key: 'onRoadShare',
      label: 'On-road share',
      unitLabel: 'share of the fleet, 0 to 1',
    });
  });

  it('accepts a known metric and falls back to the default for anything else', () => {
    expect(parseTrendMetric('index')).toBe('index');
    expect(parseTrendMetric('available')).toBe('available');
    expect(parseTrendMetric(undefined)).toBe(DEFAULT_TREND_METRIC);
    expect(parseTrendMetric(null)).toBe(DEFAULT_TREND_METRIC);
    expect(parseTrendMetric('')).toBe(DEFAULT_TREND_METRIC);
    expect(parseTrendMetric('INDEX')).toBe(DEFAULT_TREND_METRIC);
    expect(parseTrendMetric('toString')).toBe(DEFAULT_TREND_METRIC);
    expect(parseTrendMetric('__proto__')).toBe(DEFAULT_TREND_METRIC);
    expect(parseTrendMetric(['index', 'darkRate'])).toBe(DEFAULT_TREND_METRIC);
    expect(DEFAULT_TREND_METRIC).toBe('onRoadShare');
  });

  it('builds a linkable path for the network and for one depot', () => {
    expect(NETWORK_TRENDS_PATH).toBe('/project/depots/trends');
    expect(depotTrendsPath('20')).toBe('/project/depots/d/20/trends');
    expect(trendsHref(NETWORK_TRENDS_PATH, 'darkRate')).toBe('/project/depots/trends?metric=darkRate');
    expect(trendsHref(depotTrendsPath('20'), 'index')).toBe(
      '/project/depots/d/20/trends?metric=index',
    );
  });
});

describe('page wording', () => {
  it('says once that the history is generated and will be replaced by measured history', () => {
    expect(MODELLED_HISTORY_NOTE).toContain('MODELLED');
    expect(MODELLED_HISTORY_NOTE).toContain('generated until a database of real history exists');
    expect(MODELLED_HISTORY_NOTE).toContain('measured history');
    expect(MODELLED_HISTORY_NOTE.toLowerCase()).not.toContain('simulated');
  });

  it('gives the week and four-week trend sentences, each tagged MODELLED', () => {
    const result = okTrend(
      change(7, 0.3, 'steady over 7 days'),
      change(28, 2.1, 'up 2.1 percentage points over 4 weeks'),
    );
    expect(trendLines(result)).toEqual([
      'MODELLED trend over 7 days: steady over 7 days',
      'MODELLED trend over 4 weeks: up 2.1 percentage points over 4 weeks',
    ]);
  });

  it('says why there is no four-week trend when the history is under 29 days', () => {
    const result = okTrend(change(7, -1, 'down 1.0 percentage points over 7 days'), null);
    expect(trendLines(result)).toEqual([
      'MODELLED trend over 7 days: down 1.0 percentage points over 7 days',
      'No MODELLED trend over 4 weeks yet: it needs 29 days of history and this series has 90.',
    ]);
  });

  it('says why there is no trend at all, naming a gap when there is one', () => {
    expect(
      trendLines({
        status: 'insufficient_history',
        historyDays: 5,
        required: 8,
        cause: 'short_record',
        missingDate: null,
      }),
    ).toEqual(['No MODELLED trend yet: it needs 8 days of history and this series has 5.']);
    expect(
      trendLines({
        status: 'insufficient_history',
        historyDays: 3,
        required: 8,
        cause: 'gap',
        missingDate: '2026-10-02',
      }),
    ).toEqual([
      'No MODELLED trend yet: the history is missing 2 Oct 2026, so only the 3 days since count, and a trend needs 8.',
    ]);
    expect(trendLines({ status: 'invalid_input', reason: 'out_of_range' })).toEqual([
      'No MODELLED trend: the history for this measure could not be read.',
    ]);
  });
});

describe('trend lines beside live figures', () => {
  it('maps the primary figures that have a history metric, and only those', () => {
    expect(KPI_TREND_METRIC).toEqual({ onRoad: 'onRoadShare', noSignal: 'darkRate' });
    expect(COCKPIT_TREND_METRIC).toBe('onRoadShare');
  });

  it('names the metric, tags it MODELLED and states the week', () => {
    const result = okTrend(
      change(7, 2.1, 'up 2.1 percentage points over 7 days'),
      change(28, 0.1, 'steady over 4 weeks'),
    );
    expect(weekTrendLine('onRoadShare', result)).toBe(
      'On-road share, MODELLED: up 2.1 percentage points over 7 days',
    );
    expect(weekTrendLine('darkRate', okTrend(change(7, 0, 'steady over 7 days'), null))).toBe(
      'Dark rate, MODELLED: steady over 7 days',
    );
  });

  it('prints nothing when there is no trend', () => {
    expect(weekTrendLine('index', { status: 'invalid_input', reason: 'out_of_range' })).toBeNull();
  });
});
