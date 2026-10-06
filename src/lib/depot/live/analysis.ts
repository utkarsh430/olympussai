import type { DepotBusRow } from '@/models/depotLive';
import type { DepotFeedEnvelope } from '../api';
import type { FleetSnapshotView } from '../repositories/types';
import { UNASSIGNED_DEPOT_ID, type BusOpState, type DepotSummary } from '../types';
import type { LocatedBus, Yard } from '../infer/types';
import type { DepotScore } from '../score/types';
import type {
  BusException,
  DepotException,
  ExceptionReport,
  ExceptionSeverity,
} from '../exceptions/types';
import { classifyBusState } from '../infer/busState';
import { inferYards } from '../infer/yard';
import { locateBus } from '../infer/location';
import { scoreDepots } from '../score/dei';
import {
  assembleReport,
  countBySeverity,
  detectBusExceptions,
  detectDepotExceptions,
} from '../exceptions';
import { compareText } from '../exceptions/depotExceptions';
import { summariseDepots } from './aggregate';

export interface DepotExceptions {
  readonly depot: readonly DepotException[];
  /** Uncapped: a depot's own list never loses entries to the network cap. */
  readonly bus: readonly BusException[];
}

/**
 * Everything derived from one fleet snapshot, computed once and shared by every
 * depot view. Views read from it; none of them classifies, scores, locates or
 * detects anything again. Maps are keyed by registration or by depot id
 * (`UNASSIGNED_DEPOT_ID` for buses with no home depot).
 */
export interface SnapshotAnalysis {
  readonly feedNow: string | null;
  readonly states: ReadonlyMap<string, BusOpState>;
  readonly stateOf: (row: DepotBusRow) => BusOpState;
  readonly depots: readonly DepotSummary[];
  readonly depotsById: ReadonlyMap<string, DepotSummary>;
  readonly scores: readonly DepotScore[];
  readonly scoresById: ReadonlyMap<string, DepotScore>;
  readonly yards: ReadonlyMap<string, Yard>;
  readonly rowsByDepot: ReadonlyMap<string, readonly DepotBusRow[]>;
  readonly locations: ReadonlyMap<string, LocatedBus>;
  /** Buses of other depots (or none) standing inside each host depot's yard. */
  readonly visitorsByDepot: ReadonlyMap<string, readonly DepotBusRow[]>;
  readonly report: ExceptionReport;
  /** Depot and bus exceptions together, counted before the bus cap. */
  readonly exceptionSeverityCounts: Readonly<Record<ExceptionSeverity, number>>;
  readonly exceptionsByDepot: ReadonlyMap<string, DepotExceptions>;
}

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string | null): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    if (key === null) continue;
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

const homeOf = (depotId: string | null): string => depotId ?? UNASSIGNED_DEPOT_ID;

function byRegistration(a: DepotBusRow, b: DepotBusRow): number {
  return compareText(a.registrationNumber, b.registrationNumber);
}

function exceptionsByDepot(
  depot: readonly DepotException[],
  bus: readonly BusException[],
): Map<string, DepotExceptions> {
  const depotGroups = groupBy(depot, (e) => e.depotId);
  const busGroups = groupBy(bus, (e) => homeOf(e.depotId));
  const ids = new Set([...depotGroups.keys(), ...busGroups.keys()]);
  return new Map(
    [...ids].map((id) => [id, { depot: depotGroups.get(id) ?? [], bus: busGroups.get(id) ?? [] }]),
  );
}

function analyse(view: FleetSnapshotView): SnapshotAnalysis {
  const { rows, feedNow } = view;
  const states = new Map(rows.map((r) => [r.registrationNumber, classifyBusState(r, feedNow)]));
  // Registrations are unique after normalisation; the fallback only guards a foreign row.
  const stateOf = (r: DepotBusRow): BusOpState =>
    states.get(r.registrationNumber) ?? classifyBusState(r, feedNow);
  const depots = summariseDepots(rows, feedNow);
  const scores = scoreDepots(depots);
  const yards = inferYards(rows);
  const locations = new Map(rows.map((r) => [r.registrationNumber, locateBus(r, yards)]));
  const visitors = groupBy(rows, (r) => locations.get(r.registrationNumber)?.otherDepotId ?? null);
  for (const group of visitors.values()) group.sort(byRegistration);
  const depotExceptions = detectDepotExceptions(depots, scores, rows, stateOf);
  const busExceptions = detectBusExceptions(rows, depots, feedNow, stateOf);
  return {
    feedNow,
    states,
    stateOf,
    depots,
    depotsById: new Map(depots.map((d) => [d.id, d])),
    scores,
    scoresById: new Map(scores.map((s) => [s.depotId, s])),
    yards,
    rowsByDepot: groupBy(rows, (r) => homeOf(r.depotId)),
    locations,
    visitorsByDepot: visitors,
    report: assembleReport(depotExceptions, busExceptions),
    exceptionSeverityCounts: countBySeverity(depotExceptions, busExceptions),
    exceptionsByDepot: exceptionsByDepot(depotExceptions, busExceptions),
  };
}

/*
 * Keyed on the identity of the snapshot's rows array, not on its envelope. The
 * live snapshot serves one fetch as `live`, then `cache`, then (during an
 * outage) stale last-good, all with the same rows: one analysis covers them
 * all. A WeakMap lets an analysis go when its snapshot is no longer held.
 */
let analyses = new WeakMap<readonly DepotBusRow[], SnapshotAnalysis>();

/** The analysis for this snapshot's rows, computed at most once per rows array. */
export function analyseSnapshot(view: FleetSnapshotView): SnapshotAnalysis {
  const cached = analyses.get(view.rows);
  if (cached) return cached;
  const analysis = analyse(view);
  analyses.set(view.rows, analysis);
  return analysis;
}

/** Test seam: forget every memoised analysis (and with them every memoised view body). */
export function resetAnalysisForTests(): void {
  analyses = new WeakMap();
}

/**
 * The envelope every depot response carries. Built from the request's own
 * view on every call, never memoised: the same rows can be fresh on one
 * request and stale last-good on the next.
 */
export function feedEnvelope(view: FleetSnapshotView): DepotFeedEnvelope {
  return {
    feedNow: view.feedNow,
    fetchedAt: view.fetchedAt,
    source: view.source,
    stale: view.stale,
  };
}

/**
 * Wraps a view-body builder so it runs once per analysis, so polling clients
 * share one body per snapshot. Callers spread a fresh `feedEnvelope` over it.
 * Bodies are held weakly by their analysis, so none outlives its snapshot.
 */
export function memoiseBody<T>(
  build: (view: FleetSnapshotView, analysis: SnapshotAnalysis) => T,
): (view: FleetSnapshotView) => T {
  const bodies = new WeakMap<SnapshotAnalysis, T>();
  return (view: FleetSnapshotView): T => {
    const analysis = analyseSnapshot(view);
    if (!bodies.has(analysis)) bodies.set(analysis, build(view, analysis));
    return bodies.get(analysis) as T;
  };
}
