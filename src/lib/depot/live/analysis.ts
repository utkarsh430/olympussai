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
  yardSnapshotsSeen,
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
import { compareText } from '@/lib/depot/stats/order';
import { windowedOnRoadShares, type WindowedOnRoadShares } from '../sim/requirement';
import { operatingDateOf } from '../sim/seed';
import { summariseDepots } from './aggregate';
import { holdRequirement, type HeldRequirement } from './heldRequirement';
import {
  defaultPeakShareStore,
  holdPeakShares,
  resetPeakShareStore,
  type PeakShareStore,
} from './peakShareHold';
import {
  defaultPeakRequirementStore,
  resetPeakRequirementStore,
  type PeakRequirementStore,
} from './peakRequirementHold';
import {
  defaultServiceHoldStore,
  offerServiceSnapshot,
  resetServiceHoldStore,
  type ServiceHoldStore,
} from './serviceHold';

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
 * Four things reach back past this snapshot, each through one small holder:
 * `scores` (and the peer-comparison depot exceptions read from them) are summed
 * over the rolling window in score/windowStore.ts, `yards` carry yard
 * continuity from infer/yardMemory.ts, `requirementShares` hold each
 * depot's busiest windowed on-road share so far in the operating date
 * (live/peakShareHold.ts), and `requirement` floors each depot's peak by its
 * highest so far in the date (live/peakRequirementHold.ts). All are read once,
 * when the snapshot is first analysed, and then held with the rest; everything
 * else is this snapshot alone. The tops of those modules say exactly what
 * depends on history and what a repeated, stale, older or first snapshot does.
 * Each analysis also offers its snapshot to the hour-by-hour observation
 * (live/serviceHold.ts), which nothing in the analysis reads back.
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
  /**
   * The on-road shares the modelled requirement reads: per depot, the busiest
   * windowed share so far in the operating date. The modelled day and the
   * transfer plan both read this one map, so they rest on one requirement.
   */
  readonly requirementShares: WindowedOnRoadShares;
  /**
   * The modelled requirement for the snapshot's own operating date, each
   * depot's peak floored by its highest earlier in the date and capped at what
   * is available now; null when the snapshot has no date. The operating day and
   * the distribution view read these balances (`requirementBalances`).
   */
  readonly requirement: HeldRequirement | null;
  /** After yard continuity: the one set of yards every location and page uses. */
  readonly yards: ReadonlyMap<string, Yard>;
  /**
   * Per depot id with a home depot: feed times the yard memory has decided
   * the depot on, as it stood after this snapshot. Absent for the
   * fixture, and never keyed by the unassigned group: the memory decides
   * neither, so a count there would not mean "just started".
   */
  readonly yardSnapshotsSeen?: Readonly<Record<string, number>>;
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
  /** Absent: the requirement reads this snapshot's windowed shares alone. */
  readonly peakShares?: PeakShareStore;
  /** Absent: the requirement's peak is this snapshot's alone, with no floor. */
  readonly peakRequirements?: PeakRequirementStore;
  /** Absent: the snapshot is not recorded in the date's hour-by-hour observation. */
  readonly serviceHold?: ServiceHoldStore;
}

function defaultStores(): AnalysisStores {
  return {
    scoreWindow: defaultScoreWindowStore(),
    yardMemory: defaultYardMemoryStore(),
    peakShares: defaultPeakShareStore(),
    peakRequirements: defaultPeakRequirementStore(),
    serviceHold: defaultServiceHoldStore(),
  };
}

/** The feed's operating date, as every view takes it; null when the snapshot has none. */
function feedDateOf(view: FleetSnapshotView): string | null {
  try {
    return operatingDateOf(view.feedNow, view.fetchedAt);
  } catch {
    // Neither time carries a date: nothing can be held against a date.
    return null;
  }
}

function requirementSharesOf(
  view: FleetSnapshotView,
  scores: readonly DepotScore[],
  store: PeakShareStore | undefined,
): WindowedOnRoadShares {
  const windowed = windowedOnRoadShares(scores);
  // The recorded fixture never reads or writes a store, as with the other two.
  if (store === undefined || view.source === 'fixture') return windowed;
  return holdPeakShares(store, windowed, feedDateOf(view));
}

/**
 * Analyses one snapshot against explicit stores, without the memo. Each call
 * offers the snapshot to every store, so call it once per snapshot.
 */
export function analyseWith(view: FleetSnapshotView, stores: AnalysisStores): SnapshotAnalysis {
  const { rows, feedNow } = view;
  const states = new Map(rows.map((r) => [r.registrationNumber, classifyBusState(r, feedNow)]));
  // Registrations are unique after normalisation; the fallback only guards a foreign row.
  const stateOf = (r: DepotBusRow): BusOpState =>
    states.get(r.registrationNumber) ?? classifyBusState(r, feedNow);
  const depots = summariseDepots(rows, feedNow);
  // The recorded fixture never reads or writes either store.
  const fixture = view.source === 'fixture';
  const windowed = observeDepots(stores.scoreWindow, depots, feedNow, { fixture });
  const scores = scoreDepots(depots, windowed.values).map((score): DepotScore => {
    const window = windowed.windows.get(score.depotId);
    return { ...score, window, samples: window?.samples };
  });
  const yards = applyYardContinuity(stores.yardMemory, rows, inferYards(rows), feedNow, {
    fixture,
  });
  // Copied now: the store moves on, the memoised analysis must not.
  const seen = fixture
    ? undefined
    : Object.freeze(
        Object.fromEntries(
          [...new Set(rows.flatMap((r) => (r.depotId === null ? [] : [r.depotId])))]
            .sort()
            .map((id) => [id, yardSnapshotsSeen(stores.yardMemory, id)]),
        ),
      );
  const locations = new Map(rows.map((r) => [r.registrationNumber, locateBus(r, yards)]));
  const locate = (r: DepotBusRow): LocatedBus =>
    locations.get(r.registrationNumber) ?? locateBus(r, yards);
  const visitors = groupBy(rows, (r) => locations.get(r.registrationNumber)?.otherDepotId ?? null);
  for (const group of visitors.values()) group.sort(byRegistration);
  const scoresById = new Map(scores.map((s) => [s.depotId, s]));
  // A windowed exception states its own depot's samples, not the network's widest.
  const depotExceptions = detectDepotExceptions(depots, scores, rows, stateOf).map(
    (e): DepotException =>
      e.basis === 'window' ? { ...e, samples: scoresById.get(e.depotId)?.samples ?? 1 } : e,
  );
  const busExceptions = detectBusExceptions(rows, depots, feedNow, stateOf);
  const requirementShares = requirementSharesOf(view, scores, stores.peakShares);
  const requirement = holdRequirement({
    depots,
    yards,
    shares: requirementShares,
    operatingDate: feedDateOf(view),
    // The recorded fixture never reads or writes a store, as with the others.
    store: fixture ? undefined : stores.peakRequirements,
  });
  const analysis: SnapshotAnalysis = {
    feedNow,
    states,
    stateOf,
    depots,
    depotsById: new Map(depots.map((d) => [d.id, d])),
    scores,
    scoresById,
    scoreWindow: windowed.window,
    requirementShares,
    requirement,
    yards,
    ...(seen === undefined ? {} : { yardSnapshotsSeen: seen }),
    rowsByDepot: groupBy(rows, (r) => homeOf(r.depotId)),
    locations,
    locate,
    visitorsByDepot: visitors,
    report: assembleReport(depotExceptions, busExceptions),
    busExceptions,
    exceptionSeverityCounts: countBySeverity(depotExceptions, busExceptions),
    exceptionsByDepot: exceptionsByDepot(depotExceptions, busExceptions),
  };
  // Written only, never read here: the hourly view reads the hold through its repository.
  if (stores.serviceHold !== undefined) offerServiceSnapshot(stores.serviceHold, view, analysis);
  return analysis;
}

/*
 * Keyed on the identity of the snapshot's rows array, not on its envelope. The
 * live snapshot serves one fetch as `live`, then `cache`, then (during an
 * outage) stale last-good, all with the same rows: one analysis covers them
 * all, and the stores are offered each snapshot exactly once. A WeakMap
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

const resetHooks = new Set<() => void>();

/**
 * Registers how a memo that outlives one snapshot (so is not held by an
 * analysis) forgets itself when the process is reset for a test.
 */
export function forgetWithAnalyses(forget: () => void): void {
  resetHooks.add(forget);
}

/**
 * Test seam: a process that has just started. Forgets every memoised analysis
 * (and with them every memoised view body), every memo registered through
 * `forgetWithAnalyses`, the score window, the yards, the held shares, the
 * held peaks and the hour-by-hour observation.
 */
export function resetAnalysisForTests(): void {
  analyses = new WeakMap();
  resetHooks.forEach((forget) => forget());
  resetScoreWindowStore();
  resetYardMemoryStore();
  resetPeakShareStore();
  resetPeakRequirementStore();
  resetServiceHoldStore();
}

/**
 * Whether a list's depot filter names a unit of this snapshot; no filter
 * always does. A well-formed id the feed does not have gets the same fixed 404
 * as the depot routes, rather than a 200 with an empty list.
 */
export function depotFilterKnown(view: FleetSnapshotView, depotId: string | null): boolean {
  if (depotId === null) return true;
  const analysis = analyseSnapshot(view);
  return analysis.depotsById.has(depotId) || analysis.exceptionsByDepot.has(depotId);
}

/** The fixed body for a depot the snapshot does not have. */
export const DEPOT_NOT_FOUND = { error: 'Depot not found' } as const;

/**
 * The envelope every depot response carries. Built from the request's own
 * view on every call, never memoised: the same rows can be fresh on one
 * request and stale last-good on the next.
 */
export function feedEnvelope(view: FleetSnapshotView): DepotFeedEnvelope {
  const envelope: DepotFeedEnvelope = {
    feedNow: view.feedNow,
    fetchedAt: view.fetchedAt,
    source: view.source,
    stale: view.stale,
  };
  const ahead = view.feedClockAheadRows ?? 0;
  return ahead > 0 ? { ...envelope, feedClockAheadRows: ahead } : envelope;
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
