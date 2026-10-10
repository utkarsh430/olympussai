import { z } from 'zod';
import { DEFAULT_HISTORY_DAYS } from '../sim/config';
import type { DepotFeedEnvelope } from '../api';
import type { DepotTrendsResponse, TrendRow } from '../forecast/api';
import { metricKindOf, UNIT_OF_KIND } from '../forecast/config';
import { summariseTrend } from '../forecast/trend';
import { metricInfo, trendSentence } from '../forecast/wording';
import type { FleetSnapshotView } from '../repositories/types';
import type { HistoryScope, MetricKey } from '../sim/types';
import { analyseSnapshot, feedEnvelope, type SnapshotAnalysis } from './analysis';
import { modelHistory } from './historyView';
import { queryMemo } from './queryMemo';

const METRICS = ['onRoadShare', 'offRoadRate', 'darkRate', 'index', 'available'] as const;
const MIN_DAYS = 7;
/** A sparkline is a glance; three months is the longest worth drawing that small. */
const MAX_DAYS = 90;
/**
 * The trend reads a longer history than the sparkline draws, so the four-week
 * "steady" threshold has two months of four-week changes to judge against.
 */
export const TREND_HISTORY_DAYS = 90;
const WHOLE_NUMBER = /^[0-9]{1,3}$/;

export interface TrendsQuery {
  readonly metric: MetricKey;
  readonly days: number;
}

export type ParsedTrendsQuery =
  { readonly ok: true; readonly query: TrendsQuery } | { readonly ok: false };

const querySchema = z
  .object({
    metric: z.enum(METRICS),
    days: z
      .string()
      .regex(WHOLE_NUMBER)
      .transform(Number)
      .pipe(z.number().int().min(MIN_DAYS).max(MAX_DAYS))
      .default(String(DEFAULT_HISTORY_DAYS)),
  })
  .strict();

/** Strict: an unknown or repeated parameter or a malformed `days` fails, unexplained. */
export function parseTrendsQuery(searchParams: URLSearchParams): ParsedTrendsQuery {
  const keys = [...searchParams.keys()];
  if (new Set(keys).size !== keys.length) return { ok: false };
  const parsed = querySchema.safeParse(Object.fromEntries(searchParams));
  return parsed.success ? { ok: true, query: parsed.data } : { ok: false };
}

async function trendRow(
  view: FleetSnapshotView,
  query: TrendsQuery,
  scope: HistoryScope,
  name: string,
): Promise<TrendRow> {
  const id = scope.kind === 'network' ? 'network' : scope.depotId;
  const days = Math.max(query.days, TREND_HISTORY_DAYS);
  const history = await modelHistory(view, { metric: query.metric, scope, days });
  if (history.status !== 200) return { id, name, endDate: '', values: [], trend: null };
  const { series } = history.body;
  const result = summariseTrend(series, query.metric);
  const sentence = trendSentence(result);
  const trend =
    result.status === 'ok' && sentence !== null
      ? {
          direction: (result.summary.fourWeeks ?? result.summary.week).direction,
          week: result.summary.week.change,
          fourWeeks: result.summary.fourWeeks?.change ?? null,
          sentence,
        }
      : null;
  const values = series.slice(-query.days).map((p) => p.value);
  return { id, name, endDate: series.at(-1)?.date ?? '', values, trend };
}

type TrendsBody = Omit<DepotTrendsResponse, keyof DepotFeedEnvelope>;

/*
 * The body depends on the rows (through the analysis), the metric and the
 * window, so it is held per analysis under that key and goes with the
 * snapshot. The window is the caller's to choose, so the memo is bounded. The
 * envelope is never part of it.
 */
const bodies = queryMemo<TrendsBody>();

async function buildBody(
  view: FleetSnapshotView,
  analysis: SnapshotAnalysis,
  query: TrendsQuery,
): Promise<TrendsBody> {
  const [network, ...units] = await Promise.all([
    trendRow(view, query, { kind: 'network' }, 'Headquarters'),
    ...analysis.depots.map((d) => trendRow(view, query, { kind: 'depot', depotId: d.id }, d.name)),
  ]);
  return {
    provenance: 'modelled',
    metric: metricInfo(query.metric),
    trendUnit: UNIT_OF_KIND[metricKindOf(query.metric)],
    days: query.days,
    network: network as TrendRow,
    units,
  };
}

/** How many trends bodies are held for this snapshot; read by the tests of the bound. */
export function heldTrendsBodies(view: FleetSnapshotView): number {
  return bodies.size(analyseSnapshot(view));
}

/**
 * Every sparkline for one metric in one response: the network and each unit,
 * a MODELLED daily series ending on its live value, and its trend in brief.
 * No forecast is fitted.
 */
export async function buildTrendsResponse(
  view: FleetSnapshotView,
  query: TrendsQuery,
): Promise<DepotTrendsResponse> {
  const analysis = analyseSnapshot(view);
  const key = `${query.metric}|${query.days}`;
  const body = await bodies.hold(analysis, key, () => buildBody(view, analysis, query));
  return { ...feedEnvelope(view), ...body };
}
