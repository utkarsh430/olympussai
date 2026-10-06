import type { DepotBusView } from '../api';
import type { AssignmentPlan, Duty, PlanNow } from '../duties/types';
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
  /** True when the depot has no yard, so eligibility ignored location. */
  readonly locationIgnored: boolean;
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
  /** Minutes past midnight on the feed clock when it reads the operating date, else null. */
  readonly feedMinute?: number | null;
  readonly now?: PlanNow;
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
 * The first bus per trimmed registration, with its registration trimmed, and
 * how many rows were dropped. The feed can repeat a registration (the same
 * text, or with stray spaces) and one bus cannot run two duties. "First" is the
 * order of the bus views, which `depotBusViews` sorts by state then
 * registration; rows that tie on both (a repeat of the same text) keep the
 * one with a route, then the lower route name, so the pick never depends on
 * the order the feed sent them in.
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
    const tie =
      held !== undefined && raw.get(key) === bus.registrationNumber && held.state === bus.state;
    if (held === undefined || (tie && routeFirst(bus, held))) {
      kept.set(key, bus.registrationNumber === key ? bus : { ...bus, registrationNumber: key });
      raw.set(key, bus.registrationNumber);
    }
  }
  return { buses: [...kept.values()], dropped: buses.length - kept.size };
}

/** True when `a` should win a tie against `b`: a route beats none, then the lower route name. */
function routeFirst(a: DepotBusView, b: DepotBusView): boolean {
  if (a.routeName === null || b.routeName === null) return a.routeName !== null && b.routeName === null;
  return a.routeName < b.routeName;
}

function routeNamesOf(buses: readonly DepotBusView[]): string[] {
  return [...new Set(buses.flatMap((b) => (b.routeName ? [b.routeName] : [])))];
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
  const plan = assignDuties(duties, buses, fleet, {
    yardEstablished: input.yardEstablished,
    feedMinute: input.feedMinute ?? null,
  });
  return {
    duties,
    routesWithoutDuty,
    routeCount: routeNames.length,
    peakRequirement: input.peakRequirement,
    buses,
    fleet,
    plan,
    locationIgnored: !input.yardEstablished,
    duplicateRowsDropped: dropped,
  };
}
