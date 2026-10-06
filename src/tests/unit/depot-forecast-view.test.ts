// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import liveFixture from '@/fixtures/upsrtc-live-sample.json';
import { deriveFeedNow, normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';
import type { MetricKey, SeriesPoint } from '@/lib/depot/sim/types';
import { operatingDateOf } from '@/lib/depot/sim/seed';
import { resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { DEFAULT_HORIZON_DAYS, MIN_HISTORY_DAYS } from '@/lib/depot/forecast/config';
import {
  buildForecastResponse,
  forecastSections,
  parseForecastQuery,
  FORECAST_DEFAULT_DAYS,
  type ForecastQuery,
} from '@/lib/depot/live/forecastView';
import { errorSentence, metricInfo } from '@/lib/depot/forecast/wording';

const fixtureRows = normalizeDepotRows(liveFixture).rows;
const fixtureView = (over: Partial<FleetSnapshotView> = {}): FleetSnapshotView => ({
  rows: fixtureRows,
  feedNow: deriveFeedNow(fixtureRows),
  fetchedAt: '2026-10-06T08:00:05.000Z',
  source: 'live',
  stale: false,
  recordCount: fixtureRows.length,
  ...over,
});

const network = (metric: MetricKey, days = 90, horizon = 14): ForecastQuery => ({
  metric,
  scope: { kind: 'network' },
  days,
  horizon,
});

/** A daily series ending on 2026-10-06 with a weekly rhythm, in range for every metric. */
function dailySeries(length: number, value: (i: number) => number): SeriesPoint[] {
  const end = Date.UTC(2026, 9, 6);
  return Array.from({ length }, (_, i) => ({
    date: new Date(end - (length - 1 - i) * 86_400_000).toISOString().slice(0, 10),
    value: value(i),
  }));
}

beforeEach(() => resetAnalysisForTests());
afterEach(() => vi.useRealTimers());

describe('parseForecastQuery', () => {
  const parse = (query: string) => parseForecastQuery(new URLSearchParams(query));

  it('accepts the history query plus a horizon and defaults both lengths', () => {
    expect(parse('metric=index&scope=network')).toEqual({
      ok: true,
      query: {
        metric: 'index',
        scope: { kind: 'network' },
        days: FORECAST_DEFAULT_DAYS,
        horizon: DEFAULT_HORIZON_DAYS,
      },
    });
    expect(parse('metric=darkRate&scope=depot&depotId=12&days=60&horizon=7')).toEqual({
      ok: true,
      query: { metric: 'darkRate', scope: { kind: 'depot', depotId: '12' }, days: 60, horizon: 7 },
    });
    expect(parse('metric=available&scope=network&horizon=28')).toMatchObject({ ok: true });
  });

  it.each([
    ['horizon below a week', 'metric=index&scope=network&horizon=6'],
    ['horizon beyond four weeks', 'metric=index&scope=network&horizon=29'],
    ['a fractional horizon', 'metric=index&scope=network&horizon=7.5'],
    ['a signed horizon', 'metric=index&scope=network&horizon=+7'],
    ['an empty horizon', 'metric=index&scope=network&horizon='],
    ['a repeated horizon', 'metric=index&scope=network&horizon=7&horizon=8'],
    ['a repeated metric', 'metric=index&metric=index&scope=network'],
    ['an unknown key', 'metric=index&scope=network&format=csv'],
    ['an unknown metric', 'metric=speed&scope=network'],
    ['a depot scope without a depot', 'metric=index&scope=depot'],
    ['days out of range', 'metric=index&scope=network&days=400'],
  ])('refuses %s', (_name, query) => {
    expect(parse(query)).toEqual({ ok: false });
  });
});

describe('forecastSections', () => {
  const rhythm = (i: number): number => 0.6 + 0.05 * Math.sin((2 * Math.PI * i) / 7);

  it('returns a forecast with its method, error and horizon sentences', () => {
    const sections = forecastSections(dailySeries(90, rhythm), 'onRoadShare', 14);
    expect(sections.trend.provenance).toBe('modelled');
    expect(sections.forecast.provenance).toBe('modelled');
    expect(sections.trend.result.status).toBe('ok');
    const { result } = sections.forecast;
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.forecast.points).toHaveLength(14);
    expect(sections.sentences.unavailable).toBeNull();
    expect(sections.sentences.method).toMatch(/\.$/);
    expect(sections.sentences.error).toBe(
      errorSentence('onRoadShare', result.forecast.backtestMae, result.forecast.backtestDays),
    );
    expect(sections.sentences.horizon).toContain('next 14 days');
    expect(sections.sentences.trend).toMatch(/^MODELLED trend: (up|down|steady)/);
  });

  it('says why there is no forecast when the history is short', () => {
    const sections = forecastSections(dailySeries(20, rhythm), 'onRoadShare', 14);
    expect(sections.forecast.result).toEqual({
      status: 'insufficient_history',
      historyDays: 20,
      required: MIN_HISTORY_DAYS,
      cause: 'short_record',
      missingDate: null,
    });
    expect(sections.sentences.method).toBeNull();
    expect(sections.sentences.error).toBeNull();
    expect(sections.sentences.horizon).toBeNull();
    expect(sections.sentences.unavailable).toBe(
      'No forecast: it needs at least 28 days of history and this series has 20.',
    );
  });

  it('says the history could not be read when the input is invalid', () => {
    const series = dailySeries(40, () => 1.5);
    const sections = forecastSections(series, 'onRoadShare', 14);
    expect(sections.forecast.result).toEqual({ status: 'invalid_input', reason: 'out_of_range' });
    expect(sections.trend.result.status).toBe('invalid_input');
    expect(sections.sentences.trend).toBeNull();
    expect(sections.sentences.unavailable).toBe(
      'No forecast: the history for this measure could not be read.',
    );
  });

  it('explains why the weekly method was not offered on a short history', () => {
    const sections = forecastSections(dailySeries(35, rhythm), 'onRoadShare', 14);
    expect(sections.forecast.result.status).toBe('ok');
    expect(sections.sentences.method).toBe(
      'Forecast repeats the same weekday from the week before. Weekly smoothing needs 42 days ' +
        'of history and this series has 35.',
    );
  });
});

describe('errorSentence', () => {
  it('states a rate error in percentage points, not as a fraction', () => {
    expect(errorSentence('offRoadRate', 0.012, 28)).toBe(
      'Typical error about 1.2 percentage points over the last four weeks.',
    );
  });

  it('states a count error in whole buses', () => {
    expect(errorSentence('available', 3.4, 28)).toBe(
      'Typical error about 3 buses over the last four weeks.',
    );
    expect(errorSentence('available', 1.2, 21)).toBe(
      'Typical error about 1 bus over the last 21 days.',
    );
  });

  it('states an index error in points and never rounds a real error to zero', () => {
    expect(errorSentence('index', 0.84, 28)).toBe(
      'Typical error about 0.8 points over the last four weeks.',
    );
    expect(errorSentence('index', 0.01, 28)).toBe(
      'Typical error under 0.1 points over the last four weeks.',
    );
    expect(errorSentence('index', 0, 28)).toBe('No error over the last four weeks.');
  });
});

describe('metricInfo', () => {
  it('carries the unit, the valid range and the direction through', () => {
    expect(metricInfo('onRoadShare')).toMatchObject({
      key: 'onRoadShare',
      kind: 'rate',
      unit: 'fraction',
      range: { min: 0, max: 1 },
      higherIsBetter: true,
    });
    expect(metricInfo('darkRate')).toMatchObject({ unit: 'fraction', higherIsBetter: false });
    expect(metricInfo('index')).toMatchObject({ unit: 'points', range: { min: 0, max: 100 } });
    // JSON has no Infinity: an open upper bound travels as null.
    expect(metricInfo('available')).toMatchObject({ unit: 'buses', range: { min: 0, max: null } });
  });
});

describe('buildForecastResponse', () => {
  it('ends the history on the live anchor and carries the metric and horizon', async () => {
    const result = await buildForecastResponse(fixtureView(), network('onRoadShare', 90, 21));
    expect(result.status).toBe(200);
    if (result.status !== 200) return;
    const { body } = result;
    expect(body.history.provenance).toBe('modelled');
    expect(body.history.series).toHaveLength(90);
    expect(body.history.series.at(-1)).toEqual(body.history.anchor);
    expect(body.metric).toEqual(metricInfo('onRoadShare'));
    expect(body.horizonDays).toBe(21);
    expect(body.scope).toEqual({ kind: 'network' });
    expect(body.forecast.result.status).toBe('ok');
    if (body.forecast.result.status === 'ok') {
      expect(body.forecast.result.forecast.points).toHaveLength(21);
      for (const p of body.forecast.result.forecast.points) {
        expect(p.low).toBeGreaterThanOrEqual(0);
        expect(p.high).toBeLessThanOrEqual(1);
      }
    }
    const view = fixtureView();
    expect(body.history.anchor.date).toBe(operatingDateOf(view.feedNow, view.fetchedAt));
  });

  it('returns the insufficient-history shape for a short window', async () => {
    const result = await buildForecastResponse(fixtureView(), network('index', 14));
    expect(result.status === 200 && result.body.forecast.result.status).toBe(
      'insufficient_history',
    );
  });

  it('answers 404 for a depot that is not in the feed', async () => {
    const query: ForecastQuery = { ...network('index'), scope: { kind: 'depot', depotId: '99999' } };
    expect(await buildForecastResponse(fixtureView(), query)).toEqual({
      status: 404,
      body: { error: 'Depot not found' },
    });
  });

  it('builds a fresh envelope on every call', async () => {
    const first = await buildForecastResponse(fixtureView(), network('available'));
    const second = await buildForecastResponse(
      fixtureView({ stale: true, source: 'fixture', fetchedAt: '2026-10-06T08:01:05.000Z' }),
      network('available'),
    );
    if (first.status !== 200 || second.status !== 200) throw new Error('expected 200');
    expect(first.body.stale).toBe(false);
    expect(second.body).toMatchObject({
      stale: true,
      source: 'fixture',
      fetchedAt: '2026-10-06T08:01:05.000Z',
    });
  });

  it('derives nothing from the wall clock', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2031-01-01T00:00:00Z'));
    const later = await buildForecastResponse(fixtureView(), network('darkRate'));
    vi.setSystemTime(new Date('2024-03-15T12:00:00Z'));
    resetAnalysisForTests();
    const earlier = await buildForecastResponse(fixtureView(), network('darkRate'));
    expect(later).toEqual(earlier);
  });
});
