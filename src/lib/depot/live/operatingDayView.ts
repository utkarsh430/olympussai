import type { FleetSnapshotView } from '../repositories/types';
import { cachedRouteProfiles, routeCatalogueRevision } from '../routes/routeCatalogue';
import { DEFAULT_REQUIREMENT_PARAMS } from '../sim/config';
import { feedMinuteOn, planDay, type DutyPlan } from '../sim/dayPlan';
import { dayFromPlan, nowOnFeedClock } from '../sim/operatingDay';
import type { OperatingDay } from '../sim/operatingDayTypes';
import { modelBalances, windowedOnRoadShares } from '../sim/requirement';
import { operatingDateOf } from '../sim/seed';
import { analyseSnapshot, type SnapshotAnalysis } from './analysis';
import { depotBusViews } from './depotView';

/*
 * The depot's one modelled operating day, held once per snapshot and SHARED
 * (ruling S47): the duty board, crew, parking, fuel, revenue and economics all
 * read these objects, so they cannot disagree. Two layers, each in one slot
 * per analysis that is reset (never grown) when its key changes:
 *  - the plan (duties and the bus for each), per depot, for at most two
 *    operating dates: the feed's, and the next one the parking order plans
 *    as a later day (ruling S55) once the feed's day has begun. Before the
 *    feed date's first duty, the parking order reads the feed date's own
 *    plan instead (ruling S62), so there is still one plan per date. Each
 *    plan says which way it was made (`DutyPlan.mode`); that rests on the
 *    feed clock, which is the analysis's, so the key needs no more;
 *  - the day (the plan with route lengths and distances), per depot, for one
 *    operating date and route-catalogue revision. A newly cached profile
 *    changes lengths, never which bus runs which duty, so the plan is kept.
 * The analysis is held per rows array, so both go with the snapshot.
 */

/**
 * Today's plan is as of the feed (mode `as_of_feed_time`, or `before_first_duty`
 * until its first duty starts); the parking order's later plan is `later_day`.
 */
type PlanKind = 'as_of_feed' | 'later_day';

interface PlanSlot {
  readonly operatingDate: string;
  readonly kind: PlanKind;
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

/**
 * The peak requirement of every depot: the model works on the whole network at
 * once, on the on-road shares over the rolling score window (ruling S63), as
 * the fleet-distribution view does. The analysis carries the windowed scores as
 * they stood when its snapshot was offered to the window, so a memo on the
 * analysis also holds the window's state.
 */
function peakRequirements(
  analysis: SnapshotAnalysis,
  operatingDate: string,
): ReadonlyMap<string, number> {
  const balances = modelBalances(
    analysis.depots,
    analysis.yards,
    operatingDate,
    DEFAULT_REQUIREMENT_PARAMS,
    windowedOnRoadShares(analysis.scores),
  );
  return new Map(balances.map((balance) => [balance.depotId, balance.peakRequirement] as const));
}

function planSlotFor(analysis: SnapshotAnalysis, operatingDate: string, kind: PlanKind): PlanSlot {
  const byDate = plans.get(analysis) ?? new Map<string, PlanSlot>();
  plans.set(analysis, byDate);
  const key = `${kind}|${operatingDate}`;
  const held = byDate.get(key);
  if (held) return held;
  const oldest = byDate.keys().next();
  if (byDate.size >= PLAN_DATES_HELD && !oldest.done) byDate.delete(oldest.value);
  const peaks = peakRequirements(analysis, operatingDate);
  const slot = { operatingDate, kind, peaks, byDepot: new Map() };
  byDate.set(key, slot);
  return slot;
}

function planFor(
  analysis: SnapshotAnalysis,
  depotId: string,
  operatingDate: string,
  kind: PlanKind,
): DutyPlan | null {
  const slot = planSlotFor(analysis, operatingDate, kind);
  if (slot.byDepot.has(depotId)) return slot.byDepot.get(depotId) ?? null;
  const depot = analysis.depotsById.get(depotId);
  const now =
    kind === 'later_day'
      ? ({ kind: 'later_day' } as const)
      : nowOnFeedClock(feedMinuteOn(analysis.feedNow, operatingDate));
  const planned =
    depot === undefined
      ? null
      : planDay({
          depot,
          buses: depotBusViews(analysis, depotId),
          peakRequirement: slot.peaks.get(depotId) ?? 0,
          operatingDate,
          yardEstablished: analysis.yards.has(depotId),
          now,
        });
  slot.byDepot.set(depotId, planned);
  return planned;
}

/**
 * The depot's one duty plan for the feed's operating date, as of the feed
 * clock (no clock when the feed has none), or null for an unknown depot.
 * Before the date's first duty starts, the day has not begun (ruling S62b):
 * every eligible bus can take a duty, the buses standing in the yard on the
 * earliest duties and the buses still out on the ones after. The bus set is
 * the depot's bus views, one per trimmed registration. No upstream call is
 * made.
 */
export function dutyPlanFor(
  analysis: SnapshotAnalysis,
  depotId: string,
  operatingDate: string,
): DutyPlan | null {
  return planFor(analysis, depotId, operatingDate, 'as_of_feed');
}

/**
 * The depot's duty plan for a LATER operating date (the night parking order
 * plans tomorrow once today has begun), or null for an unknown depot. It does
 * not rank buses by how they stand now: the buses standing in the yard are the
 * ones that will leave it (ruling S55). It covers the YARD BUSES ONLY: every
 * bus out now is held out as `not_in_yard`, so its duties without a bus are
 * not a shortfall of the depot. Only the parking order's first-duty lookup may
 * read it; never take it as the depot's whole day.
 */
export function laterDayPlanFor(
  analysis: SnapshotAnalysis,
  depotId: string,
  operatingDate: string,
): DutyPlan | null {
  return planFor(analysis, depotId, operatingDate, 'later_day');
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
