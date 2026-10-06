import type { DepotBusRow } from '@/models/depotLive';
import type { DepotFeedEnvelope } from '../api';
import type { FleetSnapshotView } from '../repositories/types';
import { UNASSIGNED_DEPOT_ID, type BusOpState, type DepotSummary } from '../types';
import type { LocatedBus, Yard } from '../infer/types';
import type { DepotScore, ScoreWindow } from '../score/types';
import type {
  BusException,
  DepotException,
  ExceptionReport,
  ExceptionSeverity,
} from '../exceptions/types';
import { classifyBusState } from '../infer/busState';
import { inferYards } from '../infer/yard';
import {
  applyYardContinuity,
  defaultYardMemoryStore,
  resetYardMemoryStore,
  type YardMemoryStore,
} from '../infer/yardMemory';
import { locateBus } from '../infer/location';
import { scoreDepots } from '../score/dei';
import {
  defaultScoreWindowStore,
  observeDepots,
  resetScoreWindowStore,
  type ScoreWindowStore,
} from '../score/windowStore';
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
 *
 * Two things reach back past this snapshot, each through one small holder:
 * `scores` (and the peer-comparison depot exceptions read from them) are summed
 * over the rolling window in score/windowStore.ts, and `yards` carry yard
 * continuity from infer/yardMemory.ts. Both are read once, when the snapshot is
 * first analysed, and then held with the rest; everything else is this
 * snapshot alone. The tops of those two modules say exactly what depends on
 * history and what a repeated, stale, older or first snapshot does.
 */
export interface SnapshotAnalysis {
  readonly feedNow: string | null;
  readonly states: ReadonlyMap<string, BusOpState>;
  readonly stateOf: (row: DepotBusRow) => BusOpState;
  readonly depots: readonly DepotSummary[];
  readonly depotsById: ReadonlyMap<string, DepotSummary>;
  readonly scores: readonly DepotScore[];
  readonly scoresById: ReadonlyMap<string, DepotScore>;
  /** The widest window the scores were summed over: what a network screen states. */
  readonly scoreWindow: ScoreWindow;
  /** After yard continuity: the one set of yards every location and page uses. */
  readonly yards: ReadonlyMap<string, Yard>;
  readonly rowsByDepot: ReadonlyMap<string, readonly DepotBusRow[]>;
  readonly locations: ReadonlyMap<string, LocatedBus>;
  /** The one function a bus's location comes from, for every view. */
  readonly locate: (row: DepotBusRow) => LocatedBus;
  /** Buses of other depots (or none) standing inside each host depot's yard. */
  readonly visitorsByDepot: ReadonlyMap<string, readonly DepotBusRow[]>;
  readonly report: ExceptionReport;
  /** Every bus exception on the snapshot, uncapped and in network order; `report.bus` is its head. */
  readonly busExceptions: readonly BusException[];
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

/** The state that outlives a snapshot. Injected so a sequence of snapshots is reproducible. */
export interface AnalysisStores {
  readonly scoreWindow: ScoreWindowStore;
  readonly yardMemory: YardMemoryStore;
}

function defaultStores(): AnalysisStores {
  return { scoreWindow: defaultScoreWindowStore(), yardMemory: defaultYardMemoryStore() };
}

/**
 * Analyses one snapshot against explicit stores, without the memo. Each call
 * offers the snapshot to both stores, so call it once per snapshot.
 */
export function analyseWith(view: FleetSnapshotView, stores: AnalysisStores): SnapshotAnalysis {
  const { rows, feedNow } = view;
  const states = new Map(rows.map((r) => [r.registrationNumber, classifyBusState(r, feedNow)]));
  // Registrations are unique after normalisation; the fallback only guards a foreign row.
  const stateOf = (r: DepotBusRow): BusOpState =>
    states.get(r.registrationNumber) ?? classifyBusState(r, feedNow);
  const depots = summariseDepots(rows, feedNow);
  const windowed = observeDepots(stores.scoreWindow, depots, feedNow, {
    fixture: view.source === 'fixture',
  });
  const scores = scoreDepots(depots, windowed.values).map((score): DepotScore => {
    const window = windowed.windows.get(score.depotId);
    return { ...score, window, samples: window?.samples };
  });
  const yards = applyYardContinuity(stores.yardMemory, rows, inferYards(rows), feedNow);
  const locations = new Map(rows.map((r) => [r.registrationNumber, locateBus(r, yards)]));
  const locate = (r: DepotBusRow): LocatedBus =>
    locations.get(r.registrationNumber) ?? locateBus(r, yards);
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
    scoreWindow: windowed.window,
    yards,
    rowsByDepot: groupBy(rows, (r) => homeOf(r.depotId)),
    locations,
    locate,
    visitorsByDepot: visitors,
    report: assembleReport(depotExceptions, busExceptions),
    busExceptions,
    exceptionSeverityCounts: countBySeverity(depotExceptions, busExceptions),
    exceptionsByDepot: exceptionsByDepot(depotExceptions, busExceptions),
  };
}

/*
 * Keyed on the identity of the snapshot's rows array, not on its envelope. The
 * live snapshot serves one fetch as `live`, then `cache`, then (during an
 * outage) stale last-good, all with the same rows: one analysis covers them
 * all, and the two stores are offered each snapshot exactly once. A WeakMap
 * lets an analysis go when its snapshot is no longer held.
 */
let analyses = new WeakMap<readonly DepotBusRow[], SnapshotAnalysis>();

/** The analysis for this snapshot's rows, computed at most once per rows array. */
export function analyseSnapshot(view: FleetSnapshotView): SnapshotAnalysis {
  const cached = analyses.get(view.rows);
  if (cached) return cached;
  const analysis = analyseWith(view, defaultStores());
  analyses.set(view.rows, analysis);
  return analysis;
}

/**
 * Test seam: a process that has just started. Forgets every memoised analysis
 * (and with them every memoised view body), the score window and the yards.
 */
export function resetAnalysisForTests(): void {
  analyses = new WeakMap();
  resetScoreWindowStore();
  resetYardMemoryStore();
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
