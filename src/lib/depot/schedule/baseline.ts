import { rosterCrew } from '../crew/roster';
import type { CrewSlot } from '../crew/types';
import type { DutyPlan } from '../sim/dayPlan';
import { MINUTES_PER_HOUR, TENTH } from '../units';
import { deadKmOf, figuresOf, type FigureRun } from './figures';
import type { DeadRunning } from './ports';
import type { DepotRouteNeed, ScheduleBaseline } from './types';

/*
 * Today's plan, measured by the schedule's rule: the shared duty plan every
 * depot page reads, with the crew page's roster on the crew page's pool.
 */

export function baselineOf(
  planned: DutyPlan,
  pool: readonly CrewSlot[],
  routes: readonly DepotRouteNeed[],
  deadByRoute: ReadonlyMap<string, DeadRunning | null>,
): ScheduleBaseline {
  const busOf = new Map(planned.plan.assignments.map((a) => [a.dutyId, a.registrationNumber] as const));
  const runs: FigureRun[] = planned.duties.map((duty) => ({
    routeName: duty.routeName,
    startMin: duty.startMin,
    endMin: duty.endMin,
    hasBus: (busOf.get(duty.id) ?? null) !== null,
  }));
  const roster = rosterCrew(planned.duties, pool);
  const covered = roster.assignments.filter((a) => a.driverSlot !== null && a.conductorSlot !== null);
  const hours = Math.round((covered.reduce((sum, a) => sum + a.endMin - a.startMin, 0) / MINUTES_PER_HOUR) * TENTH) / TENTH;
  const distinct = (pick: (a: (typeof covered)[number]) => string | null): number => new Set(covered.map(pick).filter((s): s is string => s !== null)).size;
  const withBus = planned.duties.filter((d) => (busOf.get(d.id) ?? null) !== null);
  return {
    source: 'duty_plan',
    mode: planned.mode,
    duties: planned.duties.length,
    figures: figuresOf({
      buses: withBus.length,
      busesWithoutBus: planned.plan.unassignedDuties,
      runs,
      crew: {
        slotsUsed: { driver: distinct((a) => a.driverSlot), conductor: distinct((a) => a.conductorSlot) },
        hoursByRole: { driver: hours, conductor: hours },
      },
      routes,
      deadKm: deadKmOf(withBus.map((d) => ({ firstRoute: d.routeName, lastRoute: d.routeName })), deadByRoute),
    }),
  };
}
