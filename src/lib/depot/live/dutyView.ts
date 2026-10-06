import type { DepotBusView } from '../api';
import type {
  BoardDuty,
  DutyBlockers,
  DutyBoardCounts,
  DutyBoardResponse,
  DutyState,
} from '../duties/api';
import type { AssignmentPlan, Duty } from '../duties/types';
import type { FleetSnapshotView } from '../repositories/types';
import { assignDuties } from '../optimise/assignDuties';
import { DEFAULT_REQUIREMENT_PARAMS } from '../sim/config';
import { modelDuties } from '../sim/duties';
import { modelBus } from '../sim/fleetMaster';
import { modelBalances } from '../sim/requirement';
import { operatingDateOf } from '../sim/seed';
import type { ModelledBus, ServiceClass } from '../sim/types';
import { analyseSnapshot, feedEnvelope, type SnapshotAnalysis } from './analysis';
import { buildDepotDetail } from './depotView';

type DutyBoardBody = Omit<DutyBoardResponse, keyof ReturnType<typeof feedEnvelope>>;

const NO_BLOCKERS: DutyBlockers = { notInYard: 0, offRoad: 0, dark: 0 };

function routeNamesOf(buses: readonly DepotBusView[]): string[] {
  return [...new Set(buses.flatMap((b) => (b.routeName ? [b.routeName] : [])))];
}

/** Counts the held-out buses of one class (or of any class) by reason. */
function blockersFor(
  excluded: readonly { readonly registrationNumber: string; readonly reason: string }[],
  fleet: ReadonlyMap<string, ModelledBus>,
  serviceClass: ServiceClass | null,
): DutyBlockers {
  let notInYard = 0;
  let offRoad = 0;
  let dark = 0;
  for (const e of excluded) {
    if (serviceClass !== null && fleet.get(e.registrationNumber)?.serviceClass !== serviceClass) {
      continue;
    }
    if (e.reason === 'not_in_yard') notInYard += 1;
    else if (e.reason === 'off_road') offRoad += 1;
    else if (e.reason === 'dark') dark += 1;
  }
  return { notInYard, offRoad, dark };
}

function stateOf(registration: string | null, blockers: DutyBlockers): DutyState {
  if (registration !== null) return 'assigned';
  return blockers.notInYard > 0 ? 'bus_not_in_yard' : 'no_bus';
}

function toBoardDuty(
  duty: Duty,
  registration: string | null,
  excluded: Parameters<typeof blockersFor>[0],
  fleet: ReadonlyMap<string, ModelledBus>,
): BoardDuty {
  const blockers = registration === null ? blockersFor(excluded, fleet, duty.serviceClass) : null;
  return {
    id: duty.id,
    routeName: duty.routeName,
    startMin: duty.startMin,
    endMin: duty.endMin,
    serviceClass: duty.serviceClass,
    registrationNumber: registration,
    state: stateOf(registration, blockers ?? NO_BLOCKERS),
    blockers,
  };
}

/** The modelled duties for one operating date and the matching of the depot's buses to them. */
export interface DutyPlan {
  readonly duties: readonly Duty[];
  readonly routesWithoutDuty: readonly string[];
  readonly routeCount: number;
  readonly peakRequirement: number;
  readonly fleet: ReadonlyMap<string, ModelledBus>;
  readonly plan: AssignmentPlan;
}

/**
 * Builds the day's modelled duties and assigns the depot's buses to them, or
 * null for an unknown depot. Exported so another view (the night parking
 * order) can read each bus's duty for a date without a second assignment.
 */
export function planDutiesFor(
  analysis: SnapshotAnalysis,
  depotId: string,
  buses: readonly DepotBusView[],
  operatingDate: string,
): DutyPlan | null {
  const depot = analysis.depotsById.get(depotId);
  if (!depot) return null;
  const balance = modelBalances(
    analysis.depots,
    analysis.yards,
    operatingDate,
    DEFAULT_REQUIREMENT_PARAMS,
  ).find((b) => b.depotId === depotId);
  const peakRequirement = balance?.peakRequirement ?? 0;
  const routeNames = routeNamesOf(buses);
  // The feed carries no scheduled durations, so every duty length is a seeded range.
  const { duties, routesWithoutDuty } = modelDuties(
    depot,
    routeNames.map((routeName) => ({ routeName, scheduledDurationMin: null })),
    peakRequirement,
    operatingDate,
  );
  const fleet = new Map(
    buses.map((b) => [b.registrationNumber, modelBus(b.registrationNumber, b.routeName)]),
  );
  const plan = assignDuties(duties, buses, fleet);
  return {
    duties,
    routesWithoutDuty,
    routeCount: routeNames.length,
    peakRequirement,
    fleet,
    plan,
  };
}

function buildBody(
  analysis: SnapshotAnalysis,
  depotId: string,
  depotName: string,
  buses: readonly DepotBusView[],
  operatingDate: string,
): DutyBoardBody | null {
  const planned = planDutiesFor(analysis, depotId, buses, operatingDate);
  if (!planned) return null;
  const { duties, plan, fleet } = planned;
  const byDuty = new Map(plan.assignments.map((a) => [a.dutyId, a.registrationNumber]));
  const board = duties.map((d) => toBoardDuty(d, byDuty.get(d.id) ?? null, plan.excluded, fleet));
  const counts: DutyBoardCounts = {
    duties: board.length,
    assigned: board.length - plan.unassignedDuties,
    unassigned: plan.unassignedDuties,
    spare: plan.spareBuses.length,
    excluded: blockersFor(plan.excluded, fleet, null),
  };
  return {
    depotId,
    depotName,
    operatingDate,
    peakRequirement: planned.peakRequirement,
    routeCount: planned.routeCount,
    duties: board,
    spareBuses: plan.spareBuses,
    routesWithoutDuty: planned.routesWithoutDuty,
    counts,
  };
}

/*
 * The body depends on the rows (through the analysis), the depot and the
 * operating date, so it is held per analysis under that key and goes with the
 * snapshot. The envelope is never part of it.
 */
const bodies = new WeakMap<SnapshotAnalysis, Map<string, DutyBoardBody>>();

/**
 * One depot's duty board, or null when the feed has no such depot. The duties
 * are MODELLED (the feed carries no timetable); the buses and their states are
 * live. The matching is a recommendation: nothing is assigned or dispatched.
 * The operating date comes from the feed clock, never the wall clock.
 */
export function buildDutyBoard(view: FleetSnapshotView, depotId: string): DutyBoardResponse | null {
  const detail = buildDepotDetail(view, depotId);
  if (!detail) return null;
  const analysis = analyseSnapshot(view);
  const operatingDate = operatingDateOf(view.feedNow, view.fetchedAt);
  const key = `${depotId}|${operatingDate}`;
  const held = bodies.get(analysis) ?? new Map<string, DutyBoardBody>();
  bodies.set(analysis, held);
  let body = held.get(key);
  if (!body) {
    const built = buildBody(analysis, depotId, detail.depot.name, detail.buses, operatingDate);
    if (!built) return null;
    body = built;
    held.set(key, body);
  }
  return { ...feedEnvelope(view), ...body };
}
