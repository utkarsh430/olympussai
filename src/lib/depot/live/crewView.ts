import type {
  AvailabilityCounts,
  CrewResponse,
  RosterShiftRow,
  UncoveredShiftRow,
} from '../crew/api';
import { crewShiftsFor, rosterCrew } from '../crew/roster';
import {
  MAX_DUTY_HOURS_PER_DAY,
  MAX_HOURS_PER_WEEK,
  type CrewAssignment,
  type CrewRepository,
  type CrewRole,
  type CrewSlot,
} from '../crew/types';
import { compareText } from '../exceptions/depotExceptions';
import type { FleetSnapshotView } from '../repositories/types';
import { operatingDateOf } from '../sim/seed';
import { analyseSnapshot, feedEnvelope, type SnapshotAnalysis } from './analysis';
import { buildDepotDetail } from './depotView';
import { planDutiesFor } from './dutyView';

/** The most covered shifts sent to the browser; the total is stated beside them. */
export const ROSTER_CAP = 200;

/** The same cap for the shifts with no crew, so a depot with no crew cannot send them all. */
export const UNCOVERED_CAP = 200;

type CrewBody = Omit<CrewResponse, keyof ReturnType<typeof feedEnvelope>>;

const emptyCounts = (): Record<keyof AvailabilityCounts, number> => ({
  available: 0,
  weekly_off: 0,
  leave: 0,
  training: 0,
  absent: 0,
});

/** Slots by availability for one role; only the count leaves, never a slot. */
function countsFor(crew: readonly CrewSlot[], role: CrewRole): AvailabilityCounts {
  const counts = emptyCounts();
  for (const slot of crew) {
    if (slot.role === role) counts[slot.availability] += 1;
  }
  return counts;
}

/**
 * Most pressing first: a shift short of both roles before one short of a
 * single role, then the earliest start, so the morning's gaps lead.
 */
function byPressure(a: UncoveredShiftRow, b: UncoveredShiftRow): number {
  return (
    b.shortRoles.length - a.shortRoles.length ||
    a.startMin - b.startMin ||
    compareText(a.dutyId, b.dutyId) ||
    a.shiftIndex - b.shiftIndex
  );
}

function shiftBase(a: CrewAssignment, route: string) {
  return {
    dutyId: a.dutyId,
    route,
    shiftIndex: a.shiftIndex,
    shiftCount: a.shiftCount,
    startMin: a.startMin,
    endMin: a.endMin,
  };
}

async function buildBody(
  view: FleetSnapshotView,
  analysis: SnapshotAnalysis,
  depotId: string,
  crewRepository: CrewRepository,
): Promise<CrewBody | null> {
  const detail = buildDepotDetail(view, depotId);
  const depot = analysis.depotsById.get(depotId);
  if (!detail || !depot) return null;
  const operatingDate = operatingDateOf(view.feedNow, view.fetchedAt);
  const planned = planDutiesFor(analysis, depotId, detail.buses, operatingDate);
  if (!planned) return null;
  const { duties } = planned;
  const crew = await crewRepository.crewFor(
    depot,
    crewShiftsFor(duties).shifts.length,
    operatingDate,
  );
  const summary = rosterCrew(duties, crew);
  const routeOf = new Map(duties.map((d) => [d.id, d.routeName]));
  const routeFor = (dutyId: string): string => routeOf.get(dutyId) ?? '';

  const uncovered: UncoveredShiftRow[] = summary.assignments
    .filter((a) => a.uncoveredReason !== null)
    .map((a) => ({
      ...shiftBase(a, routeFor(a.dutyId)),
      shortRoles: a.shortRoles,
      shortfalls: a.shortfalls,
      reason: a.uncoveredReason ?? 'no_available_crew',
    }))
    .sort(byPressure);
  const covered: RosterShiftRow[] = summary.assignments.flatMap((a) =>
    a.driverSlot !== null && a.conductorSlot !== null
      ? [{ ...shiftBase(a, routeFor(a.dutyId)), driverSlot: a.driverSlot, conductorSlot: a.conductorSlot }]
      : [],
  );
  return {
    depotId,
    depotLabel: detail.depot.name,
    operatingDate,
    provenance: 'modelled',
    summary: {
      shiftsRequired: summary.shiftsRequired,
      shiftsCovered: summary.shiftsCovered,
      shiftsUncovered: summary.shiftsUncovered,
      driver: { required: summary.required.driver, available: summary.available.driver },
      conductor: { required: summary.required.conductor, available: summary.available.conductor },
      dutiesFullyCovered: summary.dutiesFullyCovered,
      dutiesPartlyCovered: summary.dutiesPartlyCovered,
      dutiesUncovered: summary.dutiesUncovered,
      dutiesNeedingRelief: summary.dutiesNeedingRelief,
    },
    availability: { driver: countsFor(crew, 'driver'), conductor: countsFor(crew, 'conductor') },
    uncovered: uncovered.slice(0, UNCOVERED_CAP),
    uncoveredTotal: uncovered.length,
    uncoveredCap: UNCOVERED_CAP,
    roster: covered.slice(0, ROSTER_CAP),
    rosterTotal: covered.length,
    rosterCap: ROSTER_CAP,
    limits: { dailyHours: MAX_DUTY_HOURS_PER_DAY, weeklyHours: MAX_HOURS_PER_WEEK },
  };
}

/*
 * The body depends on the rows (through the analysis), the depot, the operating
 * date and the crew source, so it is held under those and goes with the
 * snapshot. The envelope is never part of it. A null body is not held.
 */
const bodies = new WeakMap<SnapshotAnalysis, WeakMap<CrewRepository, Map<string, CrewBody>>>();

/**
 * One depot's crew page payload, or null when the feed has no such depot. The
 * crew and the roster are MODELLED and recommend only: nothing is assigned.
 * The operating date comes from the feed clock, never the wall clock.
 */
export async function buildCrewResponse(
  view: FleetSnapshotView,
  depotId: string,
  crewRepository: CrewRepository,
): Promise<CrewResponse | null> {
  const analysis = analyseSnapshot(view);
  const key = `${depotId}|${operatingDateOf(view.feedNow, view.fetchedAt)}`;
  const byRepository = bodies.get(analysis) ?? new WeakMap<CrewRepository, Map<string, CrewBody>>();
  bodies.set(analysis, byRepository);
  const held = byRepository.get(crewRepository) ?? new Map<string, CrewBody>();
  byRepository.set(crewRepository, held);
  let body = held.get(key);
  if (!body) {
    const built = await buildBody(view, analysis, depotId, crewRepository);
    if (!built) return null;
    body = built;
    held.set(key, body);
  }
  return { ...feedEnvelope(view), ...body };
}
