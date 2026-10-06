import type { DepotBusRow } from '@/models/depotLive';
import type { DepotFeedEnvelope } from '../api';
import type { FleetSnapshotView } from '../repositories/types';
import { UNASSIGNED_DEPOT_ID, type BusOpState, type DepotSummary } from '../types';
import type { LocatedBus, Yard } from '../infer/types';
import type { DepotScore } from '../score/types';
import type { BusException, DepotException, ExceptionReport } from '../exceptions/types';
import { classifyBusState } from '../infer/busState';
import { inferYards } from '../infer/yard';
import { locateBus } from '../infer/location';
import { scoreDepots } from '../score/dei';
import { assembleReport, detectBusExceptions, detectDepotExceptions } from '../exceptions';
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
  /** `fetchedAt` + `source`: the memoisation key for this analysis and its views. */
  readonly key: string;
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
  readonly exceptionsByDepot: ReadonlyMap<string, DepotExceptions>;
}

/** Memoisation key shared by the analysis and every view built on it. */
export function snapshotKey(view: Pick<FleetSnapshotView, 'fetchedAt' | 'source'>): string {
  return `${view.fetchedAt}|${view.source}`;
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
  return a.registrationNumber < b.registrationNumber ? -1 : a.registrationNumber > b.registrationNumber ? 1 : 0;
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
    key: snapshotKey(view),
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
    exceptionsByDepot: exceptionsByDepot(depotExceptions, busExceptions),
  };
}

// One entry: views only ever ask about the newest snapshot, so a new key replaces it.
let memo: SnapshotAnalysis | null = null;

/** The analysis for this snapshot, computed at most once per `fetchedAt` + `source`. */
export function analyseSnapshot(view: FleetSnapshotView): SnapshotAnalysis {
  const key = snapshotKey(view);
  if (memo?.key !== key) memo = analyse(view);
  return memo;
}

/** Test seam: forget the memoised analysis. */
export function resetAnalysisForTests(): void {
  memo = null;
}

/** The envelope every depot response carries, straight from the snapshot. */
export function feedEnvelope(view: FleetSnapshotView): DepotFeedEnvelope {
  return {
    feedNow: view.feedNow,
    fetchedAt: view.fetchedAt,
    source: view.source,
    stale: view.stale,
  };
}

/**
 * Wraps a view builder so it runs once per snapshot, so polling clients share
 * one built response per fetch. A single entry tied to the analysis object
 * itself: a new snapshot (or a test reset) replaces the analysis and with it
 * every view built on the old one.
 */
export function memoiseBySnapshot<T>(
  build: (view: FleetSnapshotView, analysis: SnapshotAnalysis) => T,
): (view: FleetSnapshotView) => T {
  let entry: { readonly analysis: SnapshotAnalysis; readonly value: T } | null = null;
  return (view: FleetSnapshotView): T => {
    const analysis = analyseSnapshot(view);
    if (entry?.analysis !== analysis) entry = { analysis, value: build(view, analysis) };
    return entry.value;
  };
}
