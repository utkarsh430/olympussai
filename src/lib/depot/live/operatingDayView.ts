import type { FleetSnapshotView } from '../repositories/types';
import { cachedRouteProfiles, routeCatalogueRevision } from '../routes/routeCatalogue';
import { DEFAULT_REQUIREMENT_PARAMS } from '../sim/config';
import { feedMinuteOn, planDay, type DutyPlan } from '../sim/dayPlan';
import { dayFromPlan } from '../sim/operatingDay';
import type { OperatingDay } from '../sim/operatingDayTypes';
import { modelBalances } from '../sim/requirement';
import { operatingDateOf } from '../sim/seed';
import { analyseSnapshot, type SnapshotAnalysis } from './analysis';
import { depotBusViews } from './depotView';

/*
 * The depot's one modelled operating day, held once per snapshot and SHARED
 * (ruling S47): the duty board, crew, parking, fuel, revenue and economics all
 * read these objects, so they cannot disagree. Two layers, each in one slot
 * per analysis that is reset (never grown) when its key changes:
 *  - the plan (duties and the bus for each), per depot, for at most two
 *    operating dates (the feed's, and the next one the parking order plans);
 *  - the day (the plan with route lengths and distances), per depot, for one
 *    operating date and route-catalogue revision. A newly cached profile
 *    changes lengths, never which bus runs which duty, so the plan is kept.
 * The analysis is held per rows array, so both go with the snapshot.
 */

interface PlanSlot {
  readonly operatingDate: string;
  readonly peaks: ReadonlyMap<string, number>;
  readonly byDepot: Map<string, DutyPlan | null>;
}

interface DaySlot {
  readonly operatingDate: string;
  readonly revision: number;
  /** Real one-way lengths by route, built once per slot from the cached profiles. */
  readonly lengths: ReadonlyMap<string, number | null>;
  readonly byDepot: Map<string, OperatingDay | null>;
}

const plans = new WeakMap<SnapshotAnalysis, Map<string, PlanSlot>>();
/** The feed's date and the next one (the night parking order plans tomorrow). */
const PLAN_DATES_HELD = 2;
const days = new WeakMap<SnapshotAnalysis, DaySlot>();

/** The peak requirement of every depot: the model works on the whole network at once. */
function peakRequirements(
  analysis: SnapshotAnalysis,
  operatingDate: string,
): ReadonlyMap<string, number> {
  return new Map(
    modelBalances(analysis.depots, analysis.yards, operatingDate, DEFAULT_REQUIREMENT_PARAMS).map(
      (balance) => [balance.depotId, balance.peakRequirement] as const,
    ),
  );
}

function planSlotFor(analysis: SnapshotAnalysis, operatingDate: string): PlanSlot {
  const byDate = plans.get(analysis) ?? new Map<string, PlanSlot>();
  plans.set(analysis, byDate);
  const held = byDate.get(operatingDate);
  if (held) return held;
  const oldest = byDate.keys().next();
  if (byDate.size >= PLAN_DATES_HELD && !oldest.done) byDate.delete(oldest.value);
  const slot = { operatingDate, peaks: peakRequirements(analysis, operatingDate), byDepot: new Map() };
  byDate.set(operatingDate, slot);
  return slot;
}

/**
 * The depot's one duty plan for an operating date, or null for an unknown
 * depot. The bus set is the depot's bus views, one per trimmed registration.
 * No upstream call is made.
 */
export function dutyPlanFor(
  analysis: SnapshotAnalysis,
  depotId: string,
  operatingDate: string,
): DutyPlan | null {
  const slot = planSlotFor(analysis, operatingDate);
  if (slot.byDepot.has(depotId)) return slot.byDepot.get(depotId) ?? null;
  const depot = analysis.depotsById.get(depotId);
  const planned =
    depot === undefined
      ? null
      : planDay({
          depot,
          buses: depotBusViews(analysis, depotId),
          peakRequirement: slot.peaks.get(depotId) ?? 0,
          operatingDate,
          yardEstablished: analysis.yards.has(depotId),
          feedMinute: feedMinuteOn(analysis.feedNow, operatingDate),
        });
  slot.byDepot.set(depotId, planned);
  return planned;
}

function daySlotFor(view: FleetSnapshotView, analysis: SnapshotAnalysis, date: string): DaySlot {
  const revision = routeCatalogueRevision();
  const held = days.get(analysis);
  if (held?.operatingDate === date && held.revision === revision) return held;
  const lengths = new Map(
    [...cachedRouteProfiles(view, date)].map(([name, profile]) => [name, profile.lengthKm] as const),
  );
  const slot = { operatingDate: date, revision, lengths, byDepot: new Map() };
  days.set(analysis, slot);
  return slot;
}

/**
 * The depot's one modelled operating day for the feed's operating date
 * (ruling S41), read off its one duty plan, or null for an unknown depot. The
 * route lengths are the cached real profiles where there are any.
 */
export function operatingDayFor(view: FleetSnapshotView, depotId: string): OperatingDay | null {
  const analysis = analyseSnapshot(view);
  const operatingDate = operatingDateOf(view.feedNow, view.fetchedAt);
  const slot = daySlotFor(view, analysis, operatingDate);
  if (slot.byDepot.has(depotId)) return slot.byDepot.get(depotId) ?? null;
  const planned = dutyPlanFor(analysis, depotId, operatingDate);
  const day = planned && dayFromPlan(depotId, operatingDate, planned, slot.lengths);
  slot.byDepot.set(depotId, day);
  return day;
}
