import type { DepotApiError, DepotFeedEnvelope } from '../api';
import type { DepotForecastResponse, ForecastSections } from '../forecast/api';
import { DEFAULT_HORIZON_DAYS, MAX_HORIZON_DAYS, SEASON_DAYS } from '../forecast/config';
import { forecastSeries } from '../forecast/forecast';
import { summariseTrend } from '../forecast/trend';
import { forecastSentences, metricInfo } from '../forecast/wording';
import type { FleetSnapshotView } from '../repositories/types';
import type { MetricKey, SeriesPoint } from '../sim/types';
import { analyseSnapshot, feedEnvelope } from './analysis';
import {
  modelHistory,
  parseHistoryQuery,
  type HistoryQuery,
  type HistoryBodyResult,
} from './historyView';
import { queryMemo } from './queryMemo';

/**
 * Default history window when the query names none. Longer than the history
 * route's 30 days so the weekly-smoothing method can be offered (55 days for
 * a two-week horizon) and the backtest scores a full four weeks.
 */
export const FORECAST_DEFAULT_DAYS = 90;
/** Shorter than one weekly cycle says nothing the live value does not. */
export const MIN_HORIZON_DAYS = SEASON_DAYS;
const HORIZON_DIGITS = /^[0-9]{1,2}$/;

export interface ForecastQuery extends HistoryQuery {
  readonly horizon: number;
}

export type ParsedForecastQuery =
  { readonly ok: true; readonly query: ForecastQuery } | { readonly ok: false };

export type ForecastViewResult =
  | { readonly status: 200; readonly body: DepotForecastResponse }
  | { readonly status: 404; readonly body: DepotApiError };

const REFUSED: ParsedForecastQuery = { ok: false };

function parseHorizon(raw: string | undefined): number | null {
  if (raw === undefined) return DEFAULT_HORIZON_DAYS;
  if (!HORIZON_DIGITS.test(raw)) return null;
  const horizon = Number(raw);
  return horizon >= MIN_HORIZON_DAYS && horizon <= MAX_HORIZON_DAYS ? horizon : null;
}

/**
 * The history route's strict query plus `horizon`. The horizon is checked
 * here and the rest is handed to the history parser unchanged, so the two
 * routes can never disagree on what a valid metric, scope or window is.
 */
export function parseForecastQuery(searchParams: URLSearchParams): ParsedForecastQuery {
  const horizons = searchParams.getAll('horizon');
  if (horizons.length > 1) return REFUSED;
  const horizon = parseHorizon(horizons[0]);
  if (horizon === null) return REFUSED;
  const rest = new URLSearchParams([...searchParams].filter(([key]) => key !== 'horizon'));
  if (!rest.has('days')) rest.append('days', String(FORECAST_DEFAULT_DAYS));
  const parsed = parseHistoryQuery(rest);
  if (!parsed.ok) return REFUSED;
  return { ok: true, query: { ...parsed.query, horizon } };
}

/** Trend, forecast and their sentences for one series. Pure. */
export function forecastSections(
  series: readonly SeriesPoint[],
  metric: MetricKey,
  horizonDays: number,
): ForecastSections {
  const trend = summariseTrend(series, metric);
  const forecast = forecastSeries(series, metric, horizonDays);
  return {
    trend: { provenance: 'modelled', result: trend },
    forecast: { provenance: 'modelled', result: forecast },
    sentences: forecastSentences(metric, trend, forecast, horizonDays),
  };
}

type ForecastBody = Omit<DepotForecastResponse, keyof DepotFeedEnvelope>;
type HeldForecast = ForecastBody | Extract<HistoryBodyResult, { readonly status: 404 }>;

/*
 * The body depends on the rows (through the analysis, which also fixes the
 * live anchor and operating date), the scope, the metric, the window and the
 * horizon, so it is held per analysis under that key and goes with the
 * snapshot. A poll on the same rows therefore never refits. The window and the
 * horizon are the caller's to choose, so the memo is bounded; a 404 is not
 * held, so unknown depots cannot push real bodies out. The envelope is never
 * part of it.
 */
const bodies = queryMemo<HeldForecast>({ keep: (held) => !('status' in held) });

function bodyKey({ metric, scope, days, horizon }: ForecastQuery): string {
  const where = scope.kind === 'depot' ? `depot:${scope.depotId}` : 'network';
  return `${where}|${metric}|${days}|${horizon}`;
}

async function buildBody(view: FleetSnapshotView, query: ForecastQuery): Promise<HeldForecast> {
  const { metric, scope, days, horizon } = query;
  const history = await modelHistory(view, { metric, scope, days });
  if (history.status !== 200) return history;
  const { series, anchor } = history.body;
  return {
    metric: metricInfo(metric),
    scope,
    horizonDays: horizon,
    history: { provenance: 'modelled', series, anchor },
    ...forecastSections(series, metric, horizon),
  };
}

/** How many forecast bodies are held for this snapshot; read by the tests of the bound. */
export function heldForecastBodies(view: FleetSnapshotView): number {
  return bodies.size(analyseSnapshot(view));
}

/**
 * The forecast page payload. The history ends on this snapshot's live value,
 * the fitted body is shared by every request on the same rows, and the
 * envelope is this request's own.
 */
export async function buildForecastResponse(
  view: FleetSnapshotView,
  query: ForecastQuery,
): Promise<ForecastViewResult> {
  const held = await bodies.hold(analyseSnapshot(view), bodyKey(query), () =>
    buildBody(view, query),
  );
  if ('status' in held) return held;
  return { status: 200, body: { ...feedEnvelope(view), ...held } };
}
