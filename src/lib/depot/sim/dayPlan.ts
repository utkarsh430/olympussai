import type { DepotBusView } from '../api';
import type { AssignmentPlan, Duty, PlanMode, PlanNow } from '../duties/types';
import { assignDuties } from '../optimise/assignDuties';
import type { DepotSummary } from '../types';
import { modelDuties } from './duties';
import { modelBus } from './fleetMaster';
import type { ModelledBus } from './types';

/*
 * The one place a depot's modelled duties are generated and its buses matched
 * to them (ruling S47). The duty board, the crew roster, the night parking
 * order and the modelled day (fuel, revenue, economics) all read this plan.
 */

/** The modelled duties for one operating date and the matching of the depot's buses to them. */
export interface DutyPlan {
  readonly duties: readonly Duty[];
  readonly routesWithoutDuty: readonly string[];
  readonly routeCount: number;
  readonly peakRequirement: number;
  /** The depot's buses, one per trimmed registration, the registration trimmed. */
  readonly buses: readonly DepotBusView[];
  readonly fleet: ReadonlyMap<string, ModelledBus>;
  readonly plan: AssignmentPlan;
  /** Which of the three ways the plan was made (`PlanMode`, rulings S55, S62). */
  readonly mode: PlanMode;
  /** True when the depot has no yard, so eligibility ignored location. */
  readonly locationIgnored: boolean;
  /** True when the feed has no clock, so recency did not decide eligibility (ruling S55). */
  readonly recencyNotJudged: boolean;
  /** Feed rows left out because their registration repeated an earlier one's. */
  readonly duplicateRowsDropped: number;
}

export interface DayPlanInput {
  readonly depot: DepotSummary;
  /** The depot's feed rows as bus views, repeats and all. */
  readonly buses: readonly DepotBusView[];
  readonly peakRequirement: number;
  readonly operatingDate: string;
  /** False when the depot has no yard: location then cannot decide eligibility. */
  readonly yardEstablished: boolean;
  /**
   * As of when the plan is made: the feed clock, no clock, or a later day
   * (ruling S55). On the feed clock before the first duty, the plan is made as
   * `before_first_duty` (ruling S62).
   */
  readonly now: PlanNow;
}

const FEED_CLOCK = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/;
const MINUTES_PER_HOUR = 60;

/**
 * Minutes past midnight on the feed clock when that clock reads the operating
 * date, otherwise null (a later date's duties have not started). The digits are
 * read as written: upstream stamps Indian wall-clock time with a misleading `Z`.
 */
export function feedMinuteOn(feedNow: string | null, operatingDate: string): number | null {
  const match = feedNow === null ? null : FEED_CLOCK.exec(feedNow);
  if (!match || match[1] !== operatingDate) return null;
  return Number(match[2]) * MINUTES_PER_HOUR + Number(match[3]);
}

/**
 * One bus per trimmed registration, with its registration trimmed, and how
 * many rows were dropped. The feed can repeat a registration (the same text,
 * or with stray spaces) and one bus cannot run two duties. The row heard most
 * recently is kept (ruling S62), so a stale repeat cannot hold out a bus heard
 * a minute ago; a row with no age is heard least recently. Rows heard equally
 * recently keep the first in the order of the bus views, which `depotBusViews`
 * sorts by state then registration; rows that tie on that too (a repeat of the
 * same text) keep the one with a route, then the lower route name, so the pick
 * never depends on the order the feed sent them in.
 */
export function firstPerRegistration(buses: readonly DepotBusView[]): {
  readonly buses: readonly DepotBusView[];
  readonly dropped: number;
} {
  const kept = new Map<string, DepotBusView>();
  const raw = new Map<string, string>();
  for (const bus of buses) {
    const key = bus.registrationNumber.trim();
    const held = kept.get(key);
    const newer = held === undefined ? 0 : Math.sign(compareAge(held, bus));
    const tie =
      held !== undefined && raw.get(key) === bus.registrationNumber && held.state === bus.state;
    if (held === undefined || newer > 0 || (newer === 0 && tie && routeFirst(bus, held))) {
      kept.set(key, bus.registrationNumber === key ? bus : { ...bus, registrationNumber: key });
      raw.set(key, bus.registrationNumber);
    }
  }
  return { buses: [...kept.values()], dropped: buses.length - kept.size };
}

/** Positive when `b` was heard more recently than `a`; a row with no age is heard least recently. */
function compareAge(a: DepotBusView, b: DepotBusView): number {
  if (a.gpsAgeMin === b.gpsAgeMin) return 0;
  if (a.gpsAgeMin === null) return 1;
  if (b.gpsAgeMin === null) return -1;
  return a.gpsAgeMin - b.gpsAgeMin;
}

/** True when `a` should win a tie against `b`: a route beats none, then the lower route name. */
function routeFirst(a: DepotBusView, b: DepotBusView): boolean {
  if (a.routeName === null || b.routeName === null) return a.routeName !== null && b.routeName === null;
  return a.routeName < b.routeName;
}

function routeNamesOf(buses: readonly DepotBusView[]): string[] {
  return [...new Set(buses.flatMap((b) => (b.routeName ? [b.routeName] : [])))];
}

/**
 * Which way the plan is made (ruling S62). On the feed clock, before the first
 * duty starts the day has not begun. A depot with no duties waits for none, and
 * a feed with no clock cannot be placed before a duty: both are as of the feed.
 */
function modeOf(now: PlanNow, duties: readonly Duty[]): PlanMode {
  if (now.kind === 'later_day') return 'later_day';
  if (now.kind !== 'feed_time' || duties.length === 0) return 'as_of_feed_time';
  const firstStart = Math.min(...duties.map((d) => d.startMin));
  return now.feedMinute < firstStart ? 'before_first_duty' : 'as_of_feed_time';
}

/** Generates the day's duties and matches the depot's buses to them, once. Pure. */
export function planDay(input: DayPlanInput): DutyPlan {
  const { buses, dropped } = firstPerRegistration(input.buses);
  const routeNames = routeNamesOf(buses);
  // The feed carries no scheduled durations, so every duty length is a seeded range.
  const { duties, routesWithoutDuty } = modelDuties(
    input.depot,
    routeNames.map((routeName) => ({ routeName, scheduledDurationMin: null })),
    input.peakRequirement,
    input.operatingDate,
  );
  const fleet = new Map(
    buses.map((b) => [b.registrationNumber, modelBus(b.registrationNumber, b.routeName)]),
  );
  const mode = modeOf(input.now, duties);
  const plan = assignDuties(duties, buses, fleet, {
    yardEstablished: input.yardEstablished,
    now: mode === 'before_first_duty' ? { kind: 'before_first_duty' } : input.now,
  });
  return {
    duties,
    routesWithoutDuty,
    routeCount: routeNames.length,
    peakRequirement: input.peakRequirement,
    buses,
    fleet,
    plan,
    mode,
    locationIgnored: !input.yardEstablished,
    recencyNotJudged: input.now.kind === 'no_feed_clock',
    duplicateRowsDropped: dropped,
  };
}
