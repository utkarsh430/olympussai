import type { DepotExceptionsResponse } from '../api';
import { detectBusExceptions } from '../exceptions';
import {
  DEFAULT_BUS_PAGE_QUERY,
  countBusSeverities,
  pageBusExceptions,
  type BusPageQuery,
} from '../exceptions/busPage';
import type { BusException, ExceptionSeverity } from '../exceptions/types';
import type { FleetSnapshotView } from '../repositories/types';
import { analyseSnapshot, feedEnvelope, type SnapshotAnalysis } from './analysis';

interface FullBusList {
  readonly all: readonly BusException[];
  readonly severity: Readonly<Record<ExceptionSeverity, number>>;
}

/*
 * The analysis keeps only the capped network list, so the full sorted list is
 * detected once per analysis, from the same inputs, and held weakly beside it.
 * Only the list is shared between requests; each page and envelope is built
 * per request.
 */
const fullLists = new WeakMap<SnapshotAnalysis, FullBusList>();

function fullBusList(view: FleetSnapshotView): FullBusList {
  const analysis = analyseSnapshot(view);
  const cached = fullLists.get(analysis);
  if (cached) return cached;
  const all = detectBusExceptions(view.rows, analysis.depots, analysis.feedNow, analysis.stateOf);
  const list = { all, severity: countBusSeverities(all) };
  fullLists.set(analysis, list);
  return list;
}

/**
 * The network exception queue with one page of bus exceptions. Counts and
 * `busTotal` come from the analysis, so they match the network view's
 * `exceptionCounts`; the envelope is this request's own, so stale data is
 * always reported as stale.
 */
export function buildPagedExceptionsResponse(
  view: FleetSnapshotView,
  query: BusPageQuery,
): DepotExceptionsResponse {
  const { depot, busTotal, counts } = analyseSnapshot(view).report;
  const list = fullBusList(view);
  return {
    ...feedEnvelope(view),
    report: { depot, busTotal, counts },
    busSeverityCounts: list.severity,
    busPage: pageBusExceptions(list.all, query),
  };
}

/** The first page of every bus kind and depot. */
export function buildExceptionsResponse(view: FleetSnapshotView): DepotExceptionsResponse {
  return buildPagedExceptionsResponse(view, DEFAULT_BUS_PAGE_QUERY);
}
