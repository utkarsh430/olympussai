import { depotHref } from '../../depotNav';
import { formatCount, signFor } from '../../format';
import type { DepotSummary } from '../../types';
import { CHOOSE_DEPOT_PATH } from '../workspaces';
import { DEFAULT_BUS_PARAMS, DEFAULT_CREW_PARAMS, OBJECTIVE_LABEL } from '../sched/config';
import { crewPool, rosterCrew, shiftsOf } from '../sched/crew';
import { classCounts, schedBusesOf } from '../sched/input';
import { buildTimetable } from '../sched/timetable';
import { tripsFor } from '../sched/trips';
import type { BusParams, BusPlan, Objective } from '../sched/types';
import { baselineBuses, optimiseBuses, restrictBuses } from '../sched/vehicles';
import type { CopilotData, LocalAnswer } from './copilot';
import { shiftDate } from './fuelAudit';

/*
 * The copilot's scheduling answers. They run the same engine as the AI Bus Scheduler,
 * the AI Crew Scheduler and the joint optimiser, on the same roster and timetable, so a
 * figure in the dock is the figure the scheduler page shows; each answer opens that page
 * to review the plan. Nothing is dispatched.
 */

/** Crew shifts a roster is sized for, per schedulable bus (as the scheduler pages use). */
const CREW_SHIFTS_PER_BUS = 1.5;
const AFTERNOON = { from: 12 * 60, to: 17 * 60 } as const;
const LIGHT_MINUTES = 120;
const n = formatCount;

const OBJECTIVE_WORDS: readonly [RegExp, Objective][] = [
  [/fewest buses|minimum bus|min(imum)? buses/, 'min_buses'],
  [/empty k(ilo)?m|dead (km|kilomet)/, 'min_empty_km'],
  [/cheap|lowest cost|minimum cost|min(imum)? cost/, 'min_cost'],
  [/coverage|cover (every|all|most)/, 'coverage'],
];

export interface DepotDay {
  readonly depot: DepotSummary;
  readonly date: string;
  readonly params: BusParams;
  readonly original: BusPlan;
  readonly optimised: BusPlan;
  readonly crewShiftHint: number;
}

/** Plans one depot's day the way the AI Bus Scheduler does. Null without the reads it needs. */
export function planDepotDay(depot: DepotSummary, data: CopilotData, tomorrow: boolean, objective: Objective): DepotDay | null {
  if (!data.fleet || !data.network || !data.operatingDate) return null;
  const buses = schedBusesOf(data.fleet, data.healthByReg, depot.id);
  if (buses.length === 0) return null;
  const date = tomorrow ? shiftDate(data.operatingDate, -1) : data.operatingDate;
  const timetable = buildTimetable({
    depot: { id: depot.id, name: depot.name, centroid: depot.centroid ?? null },
    neighbours: data.network.depots.filter((d) => d.kind === 'depot' && d.id !== depot.id).map((d) => ({ name: d.name, centroid: d.centroid ?? null })),
    busesByClass: classCounts(buses),
    operatingDate: date,
  });
  const params = { ...DEFAULT_BUS_PARAMS, objective };
  const trips = tripsFor(timetable, params);
  const restricted = restrictBuses(buses, params);
  return {
    depot,
    date,
    params,
    original: baselineBuses(timetable, trips, restricted, params),
    optimised: optimiseBuses(timetable, trips, restricted, params),
    crewShiftHint: Math.round(buses.filter((b) => b.state !== 'off_road').length * CREW_SHIFTS_PER_BUS),
  };
}

export function objectiveIn(question: string): Objective {
  return OBJECTIVE_WORDS.find(([re]) => re.test(question))?.[1] ?? 'balanced';
}

function needDepot(what: string, view: string): LocalAnswer {
  return {
    intent: 'schedule',
    headline: `Which depot should I ${what} for?`,
    paragraphs: ['Name a depot in the question (for example "for Agra Fort tomorrow"), or open a depot and ask again.'],
    bullets: [],
    actions: [{ label: 'Choose a depot', href: `${CHOOSE_DEPOT_PATH}?view=${view}` }],
    status: 'derived',
  };
}

export function scheduleAnswer(depot: DepotSummary | null, data: CopilotData, question: string): LocalAnswer | null {
  if (!depot) return needDepot('generate a schedule', 'bus-scheduler');
  const tomorrow = /tomorrow/.test(question);
  const day = planDepotDay(depot, data, tomorrow, objectiveIn(question));
  if (!day) return null;
  const o = day.optimised.metrics;
  const b = day.original.metrics;
  const byRoute = new Map<string, number>();
  for (const u of day.optimised.uncovered) byRoute.set(u.trip.routeId, (byRoute.get(u.trip.routeId) ?? 0) + 1);
  return {
    intent: 'schedule',
    headline: `${OBJECTIVE_LABEL[day.params.objective]} schedule for ${depot.name}${tomorrow ? ' tomorrow' : ' today'}: ${n(o.busesUsed)} buses run ${n(o.covered)} of ${n(o.departures)} departures.`,
    paragraphs: [
      `I generated it with the AI Bus Scheduler's engine on the live roster (${n(o.eligibleBuses)} buses eligible after off-road, overdue and reserve holds) and the depot's scenario timetable. The original plan, with buses fixed to routes, runs ${n(b.covered)} and has ${n(day.original.conflicts.length)} vehicle conflicts.`,
      `Change against the original: ${signFor(o.covered - b.covered)}${n(Math.abs(o.covered - b.covered))} departures, ${signFor(o.idleHours - b.idleHours)}${n(Math.abs(Math.round(o.idleHours - b.idleHours)))} idle bus-hours, estimated cost per departure ₹${n(Math.round(o.cost.total / Math.max(1, o.covered)))} against ₹${n(Math.round(b.cost.total / Math.max(1, b.covered)))}.`,
    ],
    bullets: [...byRoute].slice(0, 4).map(([route, count]) => `${route}: ${count} departure${count === 1 ? '' : 's'} still uncovered`),
    actions: [
      { label: 'Open it in the AI Bus Scheduler', href: `${depotHref(depot.id)}/bus-scheduler?run=1${tomorrow ? '&date=tomorrow' : ''}` },
      { label: 'Roster crews for it', href: `${depotHref(depot.id)}/crew-scheduler${tomorrow ? '?date=tomorrow' : ''}` },
    ],
    status: 'proposed',
  };
}

export function underusedAnswer(depot: DepotSummary | null, data: CopilotData): LocalAnswer | null {
  if (!depot) return needDepot('look for underused buses', 'bus-scheduler');
  const day = planDepotDay(depot, data, false, 'balanced');
  if (!day) return null;
  const inWindow = (from: number, to: number): number => Math.max(0, Math.min(to, AFTERNOON.to) - Math.max(from, AFTERNOON.from));
  const light = day.optimised.blocks
    .map((b) => ({ reg: b.registration, minutes: b.trips.reduce((s, t) => s + inWindow(t.dep, t.arr), 0) }))
    .filter((x) => x.minutes < LIGHT_MINUTES)
    .sort((a, b) => a.minutes - b.minutes);
  const idleEligible = restrictBuses(schedBusesOf(data.fleet ?? [], data.healthByReg, depot.id), day.params).filter((b) => b.restriction === null && !day.optimised.blocks.some((x) => x.registration === b.registration));
  return {
    intent: 'underused',
    headline: `${n(light.length)} buses at ${depot.name} run under two hours between 12:00 and 17:00 in today's plan; ${n(idleEligible.length)} eligible buses have no duty at all.`,
    paragraphs: ['From the balanced plan the AI Bus Scheduler makes for today. These buses could take extra afternoon trips, cover a breakdown, or go to the workshop in the gap.'],
    bullets: light.slice(0, 6).map((x) => `${x.reg}: ${n(x.minutes)} min in service this afternoon`),
    actions: [
      { label: 'Open the plan', href: `${depotHref(depot.id)}/bus-scheduler?run=1` },
      ...(light[0] ? [{ label: `${light[0].reg} profile`, vehicle: light[0].reg, depotId: depot.id }] : []),
    ],
    status: 'proposed',
  };
}

export function compareAnswer(depot: DepotSummary | null, data: CopilotData): LocalAnswer | null {
  if (!depot) return needDepot('compare plans', 'joint-optimizer');
  const day = planDepotDay(depot, data, false, 'balanced');
  if (!day) return null;
  const pool = crewPool(depot, day.crewShiftHint, day.date, { driver: 0, conductor: 0 });
  const roster = rosterCrew(shiftsOf(day.optimised.blocks, DEFAULT_CREW_PARAMS), pool, DEFAULT_CREW_PARAMS);
  const o = day.optimised.metrics;
  const b = day.original.metrics;
  return {
    intent: 'compare',
    headline: `${depot.name}: the optimised plan runs ${n(o.covered)} departures against ${n(b.covered)} in the original, with ${n(roster.metrics.covered)} of ${n(roster.metrics.shifts)} crew shifts covered.`,
    paragraphs: ['Original: buses fixed to routes, planned before today\'s off-road and maintenance status. Optimised: buses shared across routes under the balanced objective, crews rostered within hours, breaks and the AC endorsement.'],
    bullets: [
      `Buses: ${n(b.busesUsed)} → ${n(o.busesUsed)}`,
      `Departures covered: ${n(b.covered)} → ${n(o.covered)} of ${n(o.departures)}`,
      `Idle bus-hours: ${n(Math.round(b.idleHours))} → ${n(Math.round(o.idleHours))}`,
      `Vehicle conflicts: ${n(day.original.conflicts.length)} → 0`,
      `Crew: ${n(roster.metrics.used.driver)} drivers, ${n(roster.metrics.used.conductor)} conductors, ${roster.metrics.overtimeHours.toFixed(1)} overtime hours`,
    ],
    actions: [
      { label: 'Open the Joint Fleet & Crew Optimizer', href: `${depotHref(depot.id)}/optimizer?run=1` },
      { label: 'Open the AI Bus Scheduler', href: `${depotHref(depot.id)}/bus-scheduler?run=1` },
    ],
    status: 'proposed',
  };
}

export function crewAnswer(depot: DepotSummary | null, data: CopilotData): LocalAnswer | null {
  if (!depot) return needDepot('roster crews', 'crew-scheduler');
  const day = planDepotDay(depot, data, false, 'balanced');
  if (!day) return null;
  const pool = crewPool(depot, day.crewShiftHint, day.date, { driver: 0, conductor: 0 });
  const roster = rosterCrew(shiftsOf(day.optimised.blocks, DEFAULT_CREW_PARAMS), pool, DEFAULT_CREW_PARAMS);
  const m = roster.metrics;
  return {
    intent: 'crew',
    headline: `${depot.name}: ${n(m.covered)} of ${n(m.shifts)} crew shifts can be covered today within the rules; ${n(m.reserve.driver)} drivers and ${n(m.reserve.conductor)} conductors stay in reserve.`,
    paragraphs: [`${n(m.available.driver)} drivers and ${n(m.available.conductor)} conductors are available after weekly offs, leave, training and absence (scenario crew records, anonymous slots). Each shift keeps the ${DEFAULT_CREW_PARAMS.maxDutyHours}-hour limit and a ${DEFAULT_CREW_PARAMS.minBreakMin}-minute break between a slot's shifts.`],
    bullets: m.uncovered > 0 ? [`${n(m.uncovered)} shifts have no crew within the rules`] : [`Overtime: ${m.overtimeHours.toFixed(1)} hours`],
    actions: [{ label: 'Open the AI Crew Scheduler', href: `${depotHref(depot.id)}/crew-scheduler` }],
    status: 'proposed',
  };
}
