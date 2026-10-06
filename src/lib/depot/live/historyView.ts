import { z } from 'zod';
import type { DepotApiError, DepotFeedEnvelope, DepotHistoryResponse } from '../api';
import { isValidDepotId } from '../ids';
import { getRepositories } from '../repositories';
import type { FleetSnapshotView } from '../repositories/types';
import { componentValues } from '../score/dei';
import type { DeiComponentKey } from '../score/types';
import type { ComponentValues } from '../score/window';
import { operatingDateOf } from '../sim/seed';
import type { HistoryScope, MetricKey } from '../sim/types';
import { median, ratio } from '../stats/robust';
import type { DepotSummary } from '../types';
import { analyseSnapshot, feedEnvelope, type SnapshotAnalysis } from './analysis';
import { queryMemo } from './queryMemo';

const METRICS = ['onRoadShare', 'offRoadRate', 'darkRate', 'index', 'available'] as const;
const DEFAULT_DAYS = 30;
const MIN_DAYS = 7;
const MAX_DAYS = 180;
const WHOLE_NUMBER = /^[0-9]{1,4}$/;

export interface HistoryQuery {
  readonly metric: MetricKey;
  readonly scope: HistoryScope;
  readonly days: number;
}

export type ParsedHistoryQuery =
  | { readonly ok: true; readonly query: HistoryQuery }
  | { readonly ok: false };

export type HistoryResult =
  | { readonly status: 200; readonly body: DepotHistoryResponse }
  | { readonly status: 404; readonly body: DepotApiError };

type HistoryBody = Omit<DepotHistoryResponse, keyof DepotFeedEnvelope>;

/** A history without its envelope, or the 404 explaining why there is none. */
export type HistoryBodyResult =
  | { readonly status: 200; readonly body: HistoryBody }
  | { readonly status: 404; readonly body: DepotApiError };

const querySchema = z
  .object({
    metric: z.enum(METRICS),
    scope: z.enum(['network', 'depot']),
    depotId: z.string().refine(isValidDepotId).optional(),
    days: z
      .string()
      .regex(WHOLE_NUMBER)
      .transform(Number)
      .pipe(z.number().int().min(MIN_DAYS).max(MAX_DAYS))
      .default(String(DEFAULT_DAYS)),
  })
  .strict()
  .refine((q) => (q.scope === 'depot') === (q.depotId !== undefined));

/**
 * Validates the query string before any snapshot is touched. Strict: an
 * unknown or repeated parameter, a malformed number or a depot id that is not
 * a feed id all fail, and the caller answers 400 without saying which.
 */
export function parseHistoryQuery(searchParams: URLSearchParams): ParsedHistoryQuery {
  const keys = [...searchParams.keys()];
  if (new Set(keys).size !== keys.length) return { ok: false };
  const parsed = querySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) return { ok: false };
  const { metric, scope, depotId, days } = parsed.data;
  const historyScope: HistoryScope =
    scope === 'depot' && depotId !== undefined
      ? { kind: 'depot', depotId }
      : { kind: 'network' };
  return { ok: true, query: { metric, scope: historyScope, days } };
}

const NO_VALUE: HistoryResult = { status: 404, body: { error: 'No value for this metric' } };
const NO_INDEX: HistoryResult = { status: 404, body: { error: 'No index for this depot' } };
const NO_DEPOT: HistoryResult = { status: 404, body: { error: 'Depot not found' } };

type Rates = Pick<ReturnType<typeof componentValues>, 'onRoad' | 'offRoad' | 'dark'>;

/** Network rates from summed counts of operating depots; never a mean of depot rates. */
function networkRates(depots: readonly DepotSummary[]): Rates & { readonly available: number } {
  const sum = (pick: (d: DepotSummary) => number): number =>
    depots.reduce((total, d) => total + pick(d), 0);
  const fleet = sum((d) => d.fleet);
  const offRoad = sum((d) => d.states.offRoad);
  return {
    // Same definitions as componentValues, applied to the sums.
    onRoad: ratio(sum((d) => d.states.inService + d.states.onRoad), fleet - offRoad),
    offRoad: ratio(offRoad, fleet),
    dark: ratio(sum((d) => d.states.dark), fleet),
    available: fleet - offRoad,
  };
}

/** A depot's component values from its score (summed over the window), else this snapshot's. */
function windowedComponentValues(analysis: SnapshotAnalysis, depot: DepotSummary): ComponentValues {
  const components = analysis.scoresById.get(depot.id)?.components;
  if (!components) return componentValues(depot);
  const valueOf = (key: DeiComponentKey): number | null =>
    components.find((c) => c.key === key)?.value ?? null;
  return {
    onRoad: valueOf('onRoad'),
    offRoad: valueOf('offRoad'),
    dark: valueOf('dark'),
    scheduled: valueOf('scheduled'),
    deviceHealth: valueOf('deviceHealth'),
  };
}

function networkIndex(analysis: SnapshotAnalysis): number | null {
  const indices = analysis.scores.flatMap((s) => (s.ranked && s.index !== null ? [s.index] : []));
  return median(indices);
}

/** The live value to anchor on, or the 404 explaining why there is none. */
function liveValue(
  metric: MetricKey,
  scope: HistoryScope,
  analysis: SnapshotAnalysis,
): number | HistoryResult {
  if (scope.kind === 'depot') {
    const depot = analysis.depotsById.get(scope.depotId);
    if (!depot) return NO_DEPOT;
    if (metric === 'index') return analysis.scoresById.get(depot.id)?.index ?? NO_INDEX;
    if (metric === 'available') return depot.fleet - depot.states.offRoad;
    // The windowed values the league breakdown shows (M6), not this snapshot's alone.
    const values = windowedComponentValues(analysis, depot);
    const value = { onRoadShare: values.onRoad, offRoadRate: values.offRoad, darkRate: values.dark };
    return value[metric] ?? NO_VALUE;
  }
  if (metric === 'index') return networkIndex(analysis) ?? NO_INDEX;
  const totals = networkRates(analysis.depots.filter((d) => d.kind === 'depot'));
  if (metric === 'available') return totals.available;
  const value = { onRoadShare: totals.onRoad, offRoadRate: totals.offRoad, darkRate: totals.dark };
  return value[metric] ?? NO_VALUE;
}

/** The most a modelled day may reach: the fleet, for available buses; no limit otherwise. */
function ceilingOf(
  metric: MetricKey,
  scope: HistoryScope,
  analysis: SnapshotAnalysis,
): number | undefined {
  if (metric !== 'available') return undefined;
  if (scope.kind === 'depot') return analysis.depotsById.get(scope.depotId)?.fleet;
  return analysis.depots.filter((d) => d.kind === 'depot').reduce((total, d) => total + d.fleet, 0);
}

/**
 * The modelled trend for one metric, ending on today's live value, without an
 * envelope and without a memo: for views that hold their own bodies. The
 * anchor is read from the live analysis (nothing is carried across
 * snapshots), so the series can never contradict a figure shown beside it.
 */
export async function modelHistory(
  view: FleetSnapshotView,
  query: HistoryQuery,
): Promise<HistoryBodyResult> {
  const analysis = analyseSnapshot(view);
  const live = liveValue(query.metric, query.scope, analysis);
  if (typeof live !== 'number') return live;
  if (!Number.isFinite(live)) return NO_VALUE;
  const date = operatingDateOf(view.feedNow, view.fetchedAt);
  const ceiling = ceilingOf(query.metric, query.scope, analysis);
  const series = await getRepositories().history.series(query.metric, query.scope, query.days, {
    date,
    value: live,
    ...(ceiling === undefined ? {} : { ceiling }),
  });
  // The generator clamps and rounds the anchor to the metric's precision; the
  // response reports what it actually ended on, so the two cannot diverge.
  const last = series.at(-1);
  if (last === undefined) throw new RangeError('History series is empty');
  const { date: endDate, value, ceiling: limit } = last;
  const anchor = limit === undefined ? { date: endDate, value } : { date: endDate, value, ceiling: limit };
  return { status: 200, body: { series, provenance: 'modelled', anchor } };
}

/*
 * The history route's bodies, held per snapshot analysis and query. The
 * metric, scope and window are the caller's to choose, so the memo is bounded;
 * a 404 is not held. The envelope is never part of a held body.
 */
const bodies = queryMemo<HistoryBodyResult>({ keep: (held) => held.status === 200 });

/**
 * The history route's payload: the modelled series ending on this snapshot's
 * live value, shared by every request on the same rows, with this request's
 * own feed envelope, so the page can say when the live end is stale or the
 * saved sample.
 */
export async function buildHistoryResponse(
  view: FleetSnapshotView,
  query: HistoryQuery,
): Promise<HistoryResult> {
  const { metric, scope, days } = query;
  const where = scope.kind === 'depot' ? `depot:${scope.depotId}` : 'network';
  const held = await bodies.hold(analyseSnapshot(view), `${where}|${metric}|${days}`, () =>
    modelHistory(view, query),
  );
  if (held.status !== 200) return held;
  return { status: 200, body: { ...feedEnvelope(view), ...held.body } };
}
