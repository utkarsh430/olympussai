import type {
  BoardDuty,
  DutyBlockers,
  DutyBoardCounts,
  DutyBoardResponse,
  DutyState,
} from '../duties/api';
import type { Duty, DutyAssignment } from '../duties/types';
import type { FleetSnapshotView } from '../repositories/types';
import { operatingDateOf } from '../sim/seed';
import { analyseSnapshot, feedEnvelope, type SnapshotAnalysis } from './analysis';
import { dutyPlanFor } from './operatingDayView';

type DutyBoardBody = Omit<DutyBoardResponse, keyof ReturnType<typeof feedEnvelope>>;

const NO_BLOCKERS: DutyBlockers = { notInYard: 0, notHeard: 0, offRoad: 0, dark: 0 };

/**
 * Counts the held-out buses by reason, of every class: class is a cost, not a
 * bar (ruling S47), so any held-out bus could have run any duty (ruling S55).
 */
function blockersFor(
  excluded: readonly { readonly registrationNumber: string; readonly reason: string }[],
): DutyBlockers {
  let notInYard = 0;
  let notHeard = 0;
  let offRoad = 0;
  let dark = 0;
  for (const e of excluded) {
    if (e.reason === 'not_in_yard') notInYard += 1;
    else if (e.reason === 'not_heard') notHeard += 1;
    else if (e.reason === 'off_road') offRoad += 1;
    else if (e.reason === 'dark') dark += 1;
  }
  return { notInYard, notHeard, offRoad, dark };
}

function stateOf(registration: string | null, blockers: DutyBlockers): DutyState {
  if (registration !== null) return 'assigned';
  return blockers.notInYard > 0 ? 'bus_not_in_yard' : 'no_bus';
}

function toBoardDuty(
  duty: Duty,
  assignment: DutyAssignment | undefined,
  heldOut: DutyBlockers,
): BoardDuty {
  const registration = assignment?.registrationNumber ?? null;
  const blockers = registration === null ? heldOut : null;
  return {
    id: duty.id,
    routeName: duty.routeName,
    startMin: duty.startMin,
    endMin: duty.endMin,
    serviceClass: duty.serviceClass,
    registrationNumber: registration,
    busStanding: registration === null ? null : (assignment?.busStanding ?? null),
    state: stateOf(registration, blockers ?? NO_BLOCKERS),
    blockers,
  };
}

function buildBody(
  analysis: SnapshotAnalysis,
  depotId: string,
  depotName: string,
  operatingDate: string,
): DutyBoardBody | null {
  const planned = dutyPlanFor(analysis, depotId, operatingDate);
  if (!planned) return null;
  const { duties, plan } = planned;
  const byDuty = new Map(plan.assignments.map((a) => [a.dutyId, a]));
  const heldOut = blockersFor(plan.excluded);
  const board = duties.map((d) => toBoardDuty(d, byDuty.get(d.id), heldOut));
  const counts: DutyBoardCounts = {
    duties: board.length,
    assigned: board.length - plan.unassignedDuties,
    unassigned: plan.unassignedDuties,
    spare: plan.spareBuses.length,
    excluded: heldOut,
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
    eligibilityIgnoredLocation: planned.locationIgnored,
    recencyNotJudged: planned.recencyNotJudged,
    duplicateRowsDropped: planned.duplicateRowsDropped,
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
  const analysis = analyseSnapshot(view);
  // Existence and the name come from the shared analysis; the plan is the
  // depot's one shared plan (ruling S47), so a repeat poll does no per-request work.
  const depot = analysis.depotsById.get(depotId);
  if (!depot) return null;
  const operatingDate = operatingDateOf(view.feedNow, view.fetchedAt);
  const key = `${depotId}|${operatingDate}`;
  const held = bodies.get(analysis) ?? new Map<string, DutyBoardBody>();
  bodies.set(analysis, held);
  let body = held.get(key);
  if (!body) {
    const built = buildBody(analysis, depotId, depot.name, operatingDate);
    if (!built) return null;
    body = built;
    held.set(key, body);
  }
  return { ...feedEnvelope(view), ...body };
}
