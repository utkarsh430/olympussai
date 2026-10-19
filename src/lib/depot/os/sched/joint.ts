import { rosterCrew, sequentialRoster, shiftsOf } from './crew';
import { baselineBuses, optimiseBuses } from './vehicles';
import type { BusParams, BusPlan, CrewParams, CrewRoster, CrewShift, CrewSlotView, SchedBus, Timetable, Trip } from './types';

/*
 * Joint fleet and crew optimisation. A bus plan that uses the fewest buses gives them
 * long days, and a long day needs two crews; a plan that keeps each bus's day within one
 * shift needs more buses but fewer crews. Which is better depends on which is scarcer
 * today. The optimiser plans the buses under several limits on a bus's day, rosters the
 * crew for each, and keeps the plan that runs the most passengers with a bus and a crew
 * both, then the cheapest. A departure only runs when both are there.
 */

export interface JointCandidate {
  readonly key: string;
  readonly label: string;
  readonly maxBlockHours: number;
  readonly plan: BusPlan;
  readonly shifts: readonly CrewShift[];
  readonly roster: CrewRoster;
  /** Departures with a bus and a crew. */
  readonly operable: number;
  readonly operablePassengers: number;
  /** Departures with a bus but no crew. */
  readonly busWithoutCrew: number;
  readonly cost: number;
  /** Trip ids that run. */
  readonly runs: ReadonlySet<string>;
}

export interface JointResult {
  readonly baseline: JointCandidate;
  readonly independent: JointCandidate;
  readonly candidates: readonly JointCandidate[];
  readonly best: JointCandidate;
}

export function evaluateJoint(plan: BusPlan, slots: readonly CrewSlotView[], crewParams: CrewParams, key: string, label: string, maxBlockHours: number): JointCandidate {
  const shifts = shiftsOf(plan.blocks, crewParams);
  const roster = plan.kind === 'baseline' ? sequentialRoster(shifts, slots, crewParams) : rosterCrew(shifts, slots, crewParams);
  const crewed = new Set(roster.assignments.filter((a) => a.driver && a.conductor).flatMap((a) => a.shift.trips));
  const assigned = plan.blocks.filter((b) => b.unavailable === null).flatMap((b) => b.trips);
  const running = assigned.filter((t) => crewed.has(t.id));
  return {
    key,
    label,
    maxBlockHours,
    plan,
    shifts,
    roster,
    operable: running.length,
    operablePassengers: running.reduce((s, t) => s + t.passengers, 0),
    busWithoutCrew: assigned.length - running.length,
    cost: plan.metrics.cost.total,
    runs: new Set(running.map((t) => t.id)),
  };
}

/** Block limits worth trying: one shift's length, a little more, a long day, and the person's own. */
export function blockLimits(busParams: BusParams, crewParams: CrewParams): number[] {
  const one = Math.ceil(crewParams.maxDutyHours);
  return [...new Set([one, one + 2, 12, busParams.maxBlockHours].map((h) => Math.min(18, Math.max(6, h))))].sort((a, b) => a - b);
}

const better = (a: JointCandidate, b: JointCandidate): boolean =>
  a.operablePassengers !== b.operablePassengers ? a.operablePassengers > b.operablePassengers : a.operable !== b.operable ? a.operable > b.operable : a.cost < b.cost;

export function jointOptimise(timetable: Timetable, trips: readonly Trip[], buses: readonly SchedBus[], slots: readonly CrewSlotView[], busParams: BusParams, crewParams: CrewParams): JointResult {
  const baseline = evaluateJoint(baselineBuses(timetable, trips, buses, busParams), slots, crewParams, 'baseline', 'Original plan', busParams.maxBlockHours);
  const independent = evaluateJoint(optimiseBuses(timetable, trips, buses, busParams), slots, crewParams, 'independent', 'Buses and crew planned separately', busParams.maxBlockHours);
  const candidates = blockLimits(busParams, crewParams).map((h) =>
    evaluateJoint(optimiseBuses(timetable, trips, buses, { ...busParams, maxBlockHours: h }), slots, crewParams, `cap-${h}`, `Bus day up to ${h} h`, h),
  );
  const best = candidates.reduce((acc, c) => (better(c, acc) ? c : acc), candidates[0] ?? independent);
  return { baseline, independent, candidates, best: better(independent, best) ? independent : best };
}
