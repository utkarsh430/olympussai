import type { DepotExceptionsResponse } from '../api';
import {
  DEFAULT_BUS_PAGE_QUERY,
  countBusSeverities,
  pageBusExceptions,
  type BusPageQuery,
} from '../exceptions/busPage';
import type { ExceptionSeverity } from '../exceptions/types';
import type { FleetSnapshotView } from '../repositories/types';
import { analyseSnapshot, feedEnvelope, type SnapshotAnalysis } from './analysis';

/*
 * The analysis already holds the full sorted bus list, so nothing is detected
 * again here. Only the severity counts over it are kept once per analysis,
 * weakly beside it; each page and envelope is built per request.
 */
const severityCounts = new WeakMap<SnapshotAnalysis, Readonly<Record<ExceptionSeverity, number>>>();

function severityOf(analysis: SnapshotAnalysis): Readonly<Record<ExceptionSeverity, number>> {
  const cached = severityCounts.get(analysis);
  if (cached) return cached;
  const counts = countBusSeverities(analysis.busExceptions);
  severityCounts.set(analysis, counts);
  return counts;
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
  const analysis = analyseSnapshot(view);
  const { depot, busTotal, counts } = analysis.report;
  return {
    ...feedEnvelope(view),
    report: { depot, busTotal, counts },
    busSeverityCounts: severityOf(analysis),
    busPage: pageBusExceptions(analysis.busExceptions, query),
    scoreWindow: analysis.scoreWindow,
  };
}

/** The first page of every bus kind and depot. */
export function buildExceptionsResponse(view: FleetSnapshotView): DepotExceptionsResponse {
  return buildPagedExceptionsResponse(view, DEFAULT_BUS_PAGE_QUERY);
}
