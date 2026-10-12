import type { Provenance } from '../types';
import { assignBlocks } from './assign';
import { baselineOf } from './baseline';
import { blocksOf, coverByIntervals } from './blocks';
import { compareFigures } from './compare';
import { CREW_RELEASE_GAP_MIN, DAILY_LIMIT_MIN } from './config';
import { coverShifts } from './crewCover';
import { coverageByHour, coveredAt, deadKmOf, figuresOf, type FigureRun } from './figures';
import { depotRouteNeeds } from './need';
import { clampScheduleParams } from './params';
import { piecesOf } from './pieces';
import { shiftsOf } from './shifts';
import type { ScheduleInput, ScheduleParams, SchedulePlan, UncoveredNeed, VehicleBlock } from './types';

/*
 * The AI Scheduler's pipeline: need -> pieces -> blocks -> buses -> shifts ->
 * crew -> figures against today's plan. Pure; the clock is the feed's.
 */

function worst(values: readonly Provenance[]): Provenance {
  if (values.includes('modelled')) return 'modelled';
  if (values.includes('derived')) return 'derived';
  return values[0] ?? 'modelled';
}

function uncoveredOf(
  plan: { readonly routes: SchedulePlan['routes']; readonly runs: readonly FigureRun[] },
  pastDayEnd: readonly UncoveredNeed[],
  reason: 'fleet_short' | 'buses_held_out',
): UncoveredNeed[] {
  const past = new Set(pastDayEnd.map((u) => `${u.routeName}|${u.hour}`));
  const out: UncoveredNeed[] = [...pastDayEnd];
  for (const route of plan.routes) {
    for (const hour of route.hours) {
      const short = hour.needed - coveredAt(plan.runs, route.routeName, hour.hour);
      if (short > 0 && !past.has(`${route.routeName}|${hour.hour}`)) out.push({ routeName: route.routeName, hour: hour.hour, buses: short, reason });
    }
  }
  return out;
}

export function planSchedule(input: ScheduleInput, raw: ScheduleParams = {}): SchedulePlan {
  const available = {
    driver: input.crewPool.filter((s) => s.role === 'driver' && s.availability === 'available').length,
    conductor: input.crewPool.filter((s) => s.role === 'conductor' && s.availability === 'available').length,
  };
  const { params, notes } = clampScheduleParams(raw, {
    routes: input.routes.map((r) => r.need.routeName),
    buses: input.buses.map((b) => b.registrationNumber),
    available,
  });
  const clamped = [...notes];
  const { routes, routesWithoutNeed } = depotRouteNeeds(input, params);
  const pieced = routes.map((route) => piecesOf(route, params.maxBlockMinutes));
  const pieces = pieced.flatMap((p) => p.pieces);
  const pastDayEnd = pieced.flatMap((p) => p.pastDayEnd);
  const cover = coverByIntervals(pieces, params.minTurnaroundMinutes, params.maxBlockMinutes);
  const allBlocks = blocksOf(input.depot.id, input.operatingDate, cover.sorted, cover.chains);
  const assigned = assignBlocks(input, allBlocks, params, clamped);
  const busOf = new Map(assigned.assignment.assignments.map((a) => [a.blockId, a.registrationNumber] as const));
  const withBus = assigned.blocks.filter((b) => (busOf.get(b.id) ?? null) !== null);
  const runs: FigureRun[] = assigned.blocks.flatMap((block) =>
    block.pieces.map((p) => ({ routeName: p.routeName, startMin: p.startMin, endMin: p.endMin, hasBus: (busOf.get(block.id) ?? null) !== null })),
  );
  const { shifts, blocksNeedingRelief } = shiftsOf(withBus, CREW_RELEASE_GAP_MIN, DAILY_LIMIT_MIN);
  const crew = coverShifts(shifts, input.crewPool, params.crewUnavailable, blocksNeedingRelief);
  const deadByRoute = new Map(input.routes.map((r) => [r.need.routeName, r.deadKm] as const));
  const legs = withBus.map((b: VehicleBlock) => ({
    firstRoute: (b.pieces[0] as { routeName: string }).routeName,
    lastRoute: (b.pieces[b.pieces.length - 1] as { routeName: string }).routeName,
  }));
  const figures = figuresOf({
    buses: withBus.length,
    busesWithoutBus: assigned.assignment.blocksWithoutBus,
    runs,
    crew: { slotsUsed: crew.slotsUsed, hoursByRole: crew.hoursByRole },
    routes,
    deadKm: deadKmOf(legs, deadByRoute),
  });
  const baseline = baselineOf(input.baselinePlan, input.crewPool, routes, deadByRoute);
  const shortReason = assigned.heldOut > 0 && assigned.heldOut >= assigned.droppedBlocks ? 'buses_held_out' : 'fleet_short';
  return {
    depotId: input.depot.id,
    operatingDate: input.operatingDate,
    planMode: input.baselinePlan.mode,
    params,
    clamped,
    routes,
    routesWithoutNeed,
    pieces: cover.sorted,
    blocks: assigned.blocks,
    blockLowerBound: cover.lowerBound,
    blocksOverBound: Math.max(0, allBlocks.length - cover.lowerBound),
    assignment: assigned.assignment,
    uncovered: uncoveredOf({ routes, runs }, pastDayEnd, shortReason),
    coverageByHour: coverageByHour(routes, runs),
    crew,
    figures,
    baseline,
    comparison: compareFigures(baseline.figures, figures),
    provenance: {
      need: worst(routes.map((r) => r.needProvenance)),
      timing: worst(routes.map((r) => r.timingProvenance)),
      crew: 'modelled',
      holds: input.holds[0]?.provenance ?? 'modelled',
      fleet: 'live',
    },
  };
}
