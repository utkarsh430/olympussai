import type { CrewRole } from '../crew/types';
import type { Figure } from '../types';
import { MINUTES_PER_HOUR, TENTH } from '../units';
import type { DeadRunning } from './ports';
import type { DepotRouteNeed, HourCoverage, ResourceFigures } from './types';

/*
 * Stage E: one set of figures for any day's work, so today's plan and the
 * schedule are measured by the same rule.
 */

/** One stretch of work on a route, with or without a bus. */
export interface FigureRun {
  readonly routeName: string;
  readonly startMin: number;
  readonly endMin: number;
  readonly hasBus: boolean;
}

export interface FigureCrew {
  readonly slotsUsed: Readonly<Record<CrewRole, number>>;
  readonly hoursByRole: Readonly<Record<CrewRole, number>>;
}

const overlapsHour = (run: FigureRun, hour: number): boolean =>
  run.startMin < (hour + 1) * MINUTES_PER_HOUR && run.endMin > hour * MINUTES_PER_HOUR;

/** Buses with work on the route in the hour, counting only runs that have a bus. */
export function coveredAt(runs: readonly FigureRun[], routeName: string, hour: number): number {
  return runs.filter((r) => r.hasBus && r.routeName === routeName && overlapsHour(r, hour)).length;
}

/** Per hour across the depot: buses needed and buses the runs cover (never above the need). */
export function coverageByHour(routes: readonly DepotRouteNeed[], runs: readonly FigureRun[]): HourCoverage[] {
  return Array.from({ length: 24 }, (_, hour) => {
    let needed = 0;
    let covered = 0;
    for (const route of routes) {
      const need = route.hours[hour]?.needed ?? 0;
      needed += need;
      covered += Math.min(need, coveredAt(runs, route.routeName, hour));
    }
    return { hour, needed, covered };
  });
}

/** Empty running of every run with a bus: out to its first route and back from its last. */
export function deadKmOf(
  legs: readonly { readonly firstRoute: string; readonly lastRoute: string }[],
  deadByRoute: ReadonlyMap<string, DeadRunning | null>,
): Figure<number | null> {
  let total = 0;
  let measured = 0;
  for (const leg of legs) {
    const out = deadByRoute.get(leg.firstRoute);
    const back = deadByRoute.get(leg.lastRoute);
    if (out && back) {
      total += out.outKm + back.inKm;
      measured += 1;
    }
  }
  return {
    value: measured === 0 ? null : Math.round(total * TENTH) / TENTH,
    provenance: 'derived',
    coverage: { n: measured, of: legs.length },
  };
}

export function figuresOf(args: {
  readonly buses: number;
  readonly busesWithoutBus: number;
  readonly runs: readonly FigureRun[];
  readonly crew: FigureCrew;
  readonly routes: readonly DepotRouteNeed[];
  readonly deadKm: Figure<number | null>;
}): ResourceFigures {
  const uncovered = coverageByHour(args.routes, args.runs).reduce((sum, h) => sum + (h.needed - h.covered), 0);
  return {
    buses: args.buses,
    busesWithoutBus: args.busesWithoutBus,
    crewSlots: args.crew.slotsUsed,
    crewHours: args.crew.hoursByRole,
    uncoveredBusHours: uncovered,
    deadKm: args.deadKm,
  };
}
