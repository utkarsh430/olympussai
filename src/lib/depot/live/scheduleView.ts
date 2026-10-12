import type { CrewRepository } from '../crew/types';
import { crewShiftsFor } from '../crew/roster';
import type { FleetSnapshotView, ServiceRepositories } from '../repositories/types';
import { schedulePortsFor } from '../repositories/schedulePorts';
import { routeCatalogueRevision } from '../routes/routeCatalogue';
import type { ScheduleLimits, ScheduleResponse, ScheduleSummary } from '../schedule/api';
import { DEFAULT_MAX_BLOCK_MIN, MAX_TURNAROUND_MIN, MIN_BLOCK_CAP_MIN, SURGE_BOUNDS, TARGET_LOAD_BOUNDS } from '../schedule/config';
import { clampScheduleParams, paramsKey } from '../schedule/params';
import { planSchedule } from '../schedule/planSchedule';
import type { SchedulePorts } from '../schedule/ports';
import type { ScheduleInput, ScheduleParams, SchedulePlan } from '../schedule/types';
import { feedMinuteOn } from '../sim/dayPlan';
import { nowOnFeedClock } from '../sim/operatingDay';
import { operatingDateOf } from '../sim/seed';
import { analyseSnapshot, feedEnvelope, type SnapshotAnalysis } from './analysis';
import { dutyPlanFor } from './operatingDayView';
import { queryMemo } from './queryMemo';
import { routeTableOf, operatedBy } from './routeInputs';

/*
 * One depot's schedule, held per snapshot: the engine's input once per depot
 * (it reads the shared duty plan for its anchors and baseline), and one plan
 * per clamped what-if. No upstream call is ever made.
 */

export const SCHEDULE_LIMITS: ScheduleLimits = {
  surgePercent: SURGE_BOUNDS,
  targetLoad: TARGET_LOAD_BOUNDS,
  blockMinutes: { min: MIN_BLOCK_CAP_MIN, max: DEFAULT_MAX_BLOCK_MIN },
  turnaroundMinutes: { min: 0, max: MAX_TURNAROUND_MIN },
};

const inputs = queryMemo<ScheduleInput | null>({ keep: (v) => v !== null });
const plans = queryMemo<SchedulePlan | null>({ keep: (v) => v !== null });

async function inputFor(view: FleetSnapshotView, analysis: SnapshotAnalysis, depotId: string, ports: SchedulePorts): Promise<ScheduleInput | null> {
  const depot = analysis.depotsById.get(depotId);
  if (!depot) return null;
  const operatingDate = operatingDateOf(view.feedNow, view.fetchedAt);
  const planned = dutyPlanFor(analysis, depotId, operatingDate);
  if (!planned) return null;
  const rows = routeTableOf(view).filter((row) => operatedBy(row, depotId));
  const routes = await Promise.all(
    rows.map(async (row) => {
      const [need, timing, deadKm] = await Promise.all([
        ports.need.needByHour(row.routeName, operatingDate),
        ports.timing.timingFor(row.routeName, operatingDate),
        ports.deadRunning.deadKmFor(depotId, row.routeName),
      ]);
      return { need, timing, operatorBuses: row.operators.map((o) => ({ depotId: o.depotId, buses: o.buses })), deadKm };
    }),
  );
  const [crewPool, holds] = await Promise.all([
    ports.crew.crewFor(depot, crewShiftsFor(planned.duties).shifts.length, operatingDate),
    ports.holds.holdsFor(depot, planned.buses, operatingDate),
  ]);
  const now = planned.mode === 'as_of_feed_time' ? nowOnFeedClock(feedMinuteOn(analysis.feedNow, operatingDate)) : { kind: planned.mode };
  return {
    depot,
    operatingDate,
    now,
    buses: planned.buses,
    fleet: planned.fleet,
    yardEstablished: !planned.locationIgnored,
    routes,
    crewPool,
    holds,
    baselinePlan: planned,
  };
}

async function revisionKey(view: FleetSnapshotView, depotId: string, services: ServiceRepositories): Promise<string> {
  return `${depotId}|${operatingDateOf(view.feedNow, view.fetchedAt)}|${routeCatalogueRevision()}|${await services.scheduled.revision()}`;
}

/** A short stable key of a plan's figures: equal figures, equal key. */
function planKeyOf(plan: SchedulePlan): string {
  const text = JSON.stringify([plan.operatingDate, plan.figures, plan.comparison, plan.blocks.length]);
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  return hash.toString(16).padStart(8, '0');
}

/** The depot's plan for a what-if (the baseline when `raw` is empty), or null for an unknown depot. */
export async function heldSchedulePlan(
  view: FleetSnapshotView,
  depotId: string,
  crewRepository: CrewRepository,
  services: ServiceRepositories,
  raw: ScheduleParams = {},
): Promise<{ readonly plan: SchedulePlan; readonly depotName: string } | null> {
  const analysis = analyseSnapshot(view);
  const base = await revisionKey(view, depotId, services);
  const input = await inputs.hold(analysis, base, () => inputFor(view, analysis, depotId, schedulePortsFor(view, services, crewRepository)));
  if (input === null) return null;
  const { params } = clampScheduleParams(raw, {
    routes: input.routes.map((r) => r.need.routeName),
    buses: input.buses.map((b) => b.registrationNumber),
    available: {
      driver: input.crewPool.filter((s) => s.role === 'driver' && s.availability === 'available').length,
      conductor: input.crewPool.filter((s) => s.role === 'conductor' && s.availability === 'available').length,
    },
  });
  const plan = await plans.hold(analysis, `${base}|${paramsKey(params)}`, async () => planSchedule(input, raw));
  return plan === null ? null : { plan, depotName: input.depot.name };
}

export async function buildScheduleResponse(
  view: FleetSnapshotView,
  depotId: string,
  crewRepository: CrewRepository,
  services: ServiceRepositories,
  raw: ScheduleParams = {},
): Promise<ScheduleResponse | null> {
  const held = await heldSchedulePlan(view, depotId, crewRepository, services, raw);
  if (held === null) return null;
  return {
    ...feedEnvelope(view),
    depotId,
    depotName: held.depotName,
    operatingDate: held.plan.operatingDate,
    plan: held.plan,
    planKey: planKeyOf(held.plan),
    limits: SCHEDULE_LIMITS,
  };
}

/** The roll-up's row for one depot, from its baseline plan; null for an unknown depot. */
export async function scheduleSummaryFor(
  view: FleetSnapshotView,
  depotId: string,
  crewRepository: CrewRepository,
  services: ServiceRepositories,
): Promise<ScheduleSummary | null> {
  const held = await heldSchedulePlan(view, depotId, crewRepository, services);
  if (held === null) return null;
  const { plan } = held;
  return {
    depotId,
    depotName: held.depotName,
    busesScheduled: plan.figures.buses,
    busesToday: plan.baseline.figures.buses,
    busesFreed: plan.comparison.busesFreed,
    crewSlotsUsed: plan.figures.crewSlots,
    crewSlotsToday: plan.baseline.figures.crewSlots,
    crewHours: plan.figures.crewHours.driver,
    crewHoursToday: plan.baseline.figures.crewHours.driver,
    uncoveredBusHours: plan.figures.uncoveredBusHours,
    deadKm: plan.figures.deadKm.value,
    routes: plan.routes.length,
    planKey: planKeyOf(plan),
  };
}
