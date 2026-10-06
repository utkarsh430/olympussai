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
  heldForecastBodies,
  parseForecastQuery,
  FORECAST_DEFAULT_DAYS,
  type ForecastQuery,
} from '@/lib/depot/live/forecastView';
import { errorSentence, metricInfo } from '@/lib/depot/forecast/wording';
import type { ForecastError } from '@/lib/depot/forecast/types';
import { MAX_QUERY_BODIES_PER_SNAPSHOT } from '@/lib/depot/live/queryMemo';

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
      errorSentence(result.forecast.error, result.forecast.backtestDays),
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
      'Forecast repeats the same weekday from the week before. Weekly smoothing needs 55 days ' +
        'of history for a 14-day forecast and this series has 35.',
    );
  });
});

describe('errorSentence', () => {
  const errorOf = (
    byDaysAhead: readonly number[],
    unit: ForecastError['unit'],
    statedAsFraction = false,
  ): ForecastError => ({
    overHorizon: byDaysAhead.reduce((a, b) => a + b, 0) / byDaysAhead.length,
    byDaysAhead,
    unit,
    statedAsFraction,
  });

  it('states a rate error in percentage points a day ahead and at the end of the horizon', () => {
    const error = errorOf([0.012, ...Array(12).fill(0.02), 0.029], 'percentage_points', true);
    expect(errorSentence(error, 28)).toBe(
      'MODELLED: typically within 1.2 percentage points a day ahead and 2.9 two weeks ahead, ' +
        'judged on the last four weeks.',
    );
  });

  it('states a count error in whole buses and names a week or other horizons', () => {
    expect(errorSentence(errorOf([1.2, 2, 2, 2, 2, 2, 3.4], 'buses'), 21)).toBe(
      'MODELLED: typically within 1 bus a day ahead and 3 buses a week ahead, judged on the last 21 days.',
    );
    expect(errorSentence(errorOf([0.84, 1, 1, 1, 1, 1, 1, 1, 1, 1.25], 'points'), 28)).toBe(
      'MODELLED: typically within 0.8 points a day ahead and 1.3 points 10 days ahead, ' +
        'judged on the last four weeks.',
    );
  });

  it('never rounds a real error to zero, and says when there was none', () => {
    expect(errorSentence(errorOf([0.01, 0.02], 'points'), 28)).toBe(
      'MODELLED: typically within under 0.1 points a day ahead and under 0.1 points 2 days ahead, ' +
        'judged on the last four weeks.',
    );
    expect(errorSentence(errorOf([0, 0], 'points'), 28)).toBe(
      'MODELLED: no error in the backtest over the last four weeks.',
    );
  });
});

describe('unavailableSentence', () => {
  it('names the missing day when a gap, not a short record, stops the forecast', () => {
    const gapped = dailySeries(60, (i) => 60 + (i % 7)).filter((p) => p.date !== '2026-09-30');
    const sections = forecastSections(gapped, 'index', 14);
    expect(sections.sentences.unavailable).toBe(
      'No forecast: the history is missing 30 Sep 2026, so only the 6 days since count, ' +
        'and a forecast needs 28.',
    );
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
    const query: ForecastQuery = {
      ...network('index'),
      scope: { kind: 'depot', depotId: '99999' },
    };
    expect(await buildForecastResponse(fixtureView(), query)).toEqual({
      status: 404,
      body: { error: 'Depot not found' },
    });
  });

  it('fits once per snapshot rows, scope, metric and horizon; a poll does not refit', async () => {
    const first = await buildForecastResponse(fixtureView(), network('index'));
    const poll = await buildForecastResponse(
      fixtureView({ fetchedAt: '2026-10-06T08:00:35.000Z' }),
      network('index'),
    );
    const other = await buildForecastResponse(fixtureView(), network('index', 90, 21));
    if (first.status !== 200 || poll.status !== 200 || other.status !== 200)
      throw new Error('expected 200');
    expect(poll.body.forecast).toBe(first.body.forecast);
    expect(poll.body.fetchedAt).toBe('2026-10-06T08:00:35.000Z');
    expect(other.body.forecast).not.toBe(first.body.forecast);
    const newRows = await buildForecastResponse(
      fixtureView({ rows: [...fixtureRows] }),
      network('index'),
    );
    if (newRows.status !== 200) throw new Error('expected 200');
    expect(newRows.body.forecast).not.toBe(first.body.forecast);
  });

  it('holds a bounded number of bodies on one snapshot however many queries arrive', async () => {
    const queries = Array.from({ length: MAX_QUERY_BODIES_PER_SNAPSHOT + 6 }, (_, i) =>
      network('available', 60 + i, 7 + (i % 22)),
    );
    const first = await buildForecastResponse(fixtureView(), queries[0] as ForecastQuery);
    for (const query of queries.slice(1)) await buildForecastResponse(fixtureView(), query);
    expect(heldForecastBodies(fixtureView())).toBe(MAX_QUERY_BODIES_PER_SNAPSHOT);
    const last = queries.at(-1) as ForecastQuery;
    const heldLast = await buildForecastResponse(fixtureView(), last);
    const again = await buildForecastResponse(fixtureView(), last);
    const oldest = await buildForecastResponse(fixtureView(), queries[0] as ForecastQuery);
    if (first.status !== 200 || oldest.status !== 200) throw new Error('expected 200');
    if (heldLast.status !== 200 || again.status !== 200) throw new Error('expected 200');
    expect(again.body.forecast).toBe(heldLast.body.forecast);
    // The oldest was let go, so asking again builds it afresh.
    expect(oldest.body.forecast).not.toBe(first.body.forecast);
    expect(oldest.body.forecast).toEqual(first.body.forecast);
  });

  it('does not hold an answer for a depot that is not in the feed', async () => {
    const missing: ForecastQuery = { ...network('index'), scope: { kind: 'depot', depotId: '99999' } };
    await buildForecastResponse(fixtureView(), missing);
    expect(heldForecastBodies(fixtureView())).toBe(0);
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
