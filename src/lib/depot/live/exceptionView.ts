import type { DepotExceptionsResponse, DepotExceptionsScope } from '../api';
import { BUS_EXCEPTION_KINDS } from '../exceptions/config';
import {
  DEFAULT_BUS_PAGE_QUERY,
  countBusSeverities,
  pageBusExceptions,
  type BusPageQuery,
} from '../exceptions/busPage';
import { EXCEPTION_BASIS } from '../exceptions/config';
import type { BusExceptionKind, ExceptionSeverity } from '../exceptions/types';
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

/*
 * A depot's scope depends on the rows and the depot alone (never on the kind
 * or the page), so it is kept per analysis and depot id. Only ids the snapshot
 * holds are kept, which bounds the entries by the snapshot's depots; any other
 * well-formed id is answered with an empty scope built per request.
 */
const depotScopes = new WeakMap<SnapshotAnalysis, Map<string, DepotExceptionsScope>>();

function buildScope(analysis: SnapshotAnalysis, depotId: string): DepotExceptionsScope {
  const own = analysis.exceptionsByDepot.get(depotId)?.bus ?? [];
  const busCounts = Object.fromEntries(
    BUS_EXCEPTION_KINDS.map((kind) => [kind, own.filter((row) => row.kind === kind).length]),
  ) as Record<BusExceptionKind, number>;
  return {
    depotId,
    depotName: analysis.depotsById.get(depotId)?.name ?? null,
    busCounts,
    busTotal: own.length,
    depot: analysis.report.depot.filter((row) => row.depotId === depotId),
  };
}

function scopeOf(analysis: SnapshotAnalysis, depotId: string): DepotExceptionsScope {
  const held = analysis.depotsById.has(depotId) || analysis.exceptionsByDepot.has(depotId);
  if (!held) return buildScope(analysis, depotId);
  const scopes = depotScopes.get(analysis) ?? new Map<string, DepotExceptionsScope>();
  if (!depotScopes.has(analysis)) depotScopes.set(analysis, scopes);
  const cached = scopes.get(depotId);
  if (cached) return cached;
  const scope = buildScope(analysis, depotId);
  scopes.set(depotId, scope);
  return scope;
}

/**
 * The network exception queue with one page of bus exceptions. Counts and
 * `busTotal` come from the analysis, so they match the network view's
 * `exceptionCounts`; the envelope is this request's own, so stale data is
 * always reported as stale. With a depot in the query, `depotScope` carries
 * that depot's own counts, total and depot exceptions as well.
 */
export function buildPagedExceptionsResponse(
  view: FleetSnapshotView,
  query: BusPageQuery,
): DepotExceptionsResponse {
  const analysis = analyseSnapshot(view);
  const { depot, busTotal, counts } = analysis.report;
  const scoped = query.depotId === null ? {} : { depotScope: scopeOf(analysis, query.depotId) };
  return {
    ...feedEnvelope(view),
    report: { depot, busTotal, counts },
    busSeverityCounts: severityOf(analysis),
    busPage: pageBusExceptions(analysis.busExceptions, query),
    scoreWindow: analysis.scoreWindow,
    exceptionBasis: EXCEPTION_BASIS,
    ...scoped,
  };
}

/** The first page of every bus kind and depot. */
export function buildExceptionsResponse(view: FleetSnapshotView): DepotExceptionsResponse {
  return buildPagedExceptionsResponse(view, DEFAULT_BUS_PAGE_QUERY);
}
