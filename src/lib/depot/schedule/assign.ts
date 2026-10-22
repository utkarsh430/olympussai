import type { Duty, PlanNow } from '../duties/types';
import { assignDuties } from '../optimise/assignDuties';
import { compareText } from '../stats/order';
import type { BlockAssignment, BlockHoldReason, ResolvedScheduleParams, ScheduleAssignment, ScheduleInput, VehicleBlock } from './types';

/*
 * Stage C: a real bus for each block. Holds and locks come first, then the
 * module's own duty matcher (so eligibility and plan mode agree with the
 * duty board); when there are more blocks than eligible buses the blocks
 * with the most need are kept and the rest become uncovered need.
 */

export function blocksAsDuties(blocks: readonly VehicleBlock[], depotId: string): Duty[] {
  return blocks.map((block) => ({
    id: block.id,
    depotId,
    routeName: block.mainRouteName,
    startMin: block.startMin,
    endMin: block.endMin,
    serviceClass: block.serviceClass,
    provenance: 'modelled',
  }));
}

const byNeed = (a: VehicleBlock, b: VehicleBlock): number =>
  b.needMinutes - a.needMinutes || a.startMin - b.startMin || compareText(a.id, b.id);
const byBlockOrder = (a: VehicleBlock, b: VehicleBlock): number => a.startMin - b.startMin || compareText(a.id, b.id);

function heldBuses(input: ScheduleInput, params: ResolvedScheduleParams): Map<string, BlockHoldReason> {
  const held = new Map<string, BlockHoldReason>();
  for (const reg of params.busesOutOfService) held.set(reg, 'out_of_service');
  if (params.holdForMaintenance) {
    for (const hold of input.holds) if (!held.has(hold.registrationNumber)) held.set(hold.registrationNumber, hold.reason);
  }
  return held;
}

export interface BlockAssignmentResult {
  readonly assignment: ScheduleAssignment;
  /** The blocks in the plan: locked and matched; ordered by start. */
  readonly blocks: readonly VehicleBlock[];
  readonly droppedBlocks: number;
  readonly heldOut: number;
}

/** Assigns buses to blocks; notes every lock that could not be applied. */
export function assignBlocks(
  input: ScheduleInput,
  blocks: readonly VehicleBlock[],
  params: ResolvedScheduleParams,
  notes: string[],
): BlockAssignmentResult {
  const held = heldBuses(input, params);
  const options = { yardEstablished: input.yardEstablished, now: input.now satisfies PlanNow };
  let buses = input.buses.filter((b) => !held.has(b.registrationNumber));
  let open = [...blocks].sort(byNeed);
  const locked: BlockAssignment[] = [];
  for (const lock of params.locks) {
    const bus = buses.find((b) => b.registrationNumber === lock.registrationNumber);
    if (bus === undefined) {
      notes.push(`Lock of ${lock.registrationNumber} not applied: the bus is held out`);
      continue;
    }
    const probe = assignDuties([], [bus], input.fleet, options);
    if (probe.excluded.length > 0) {
      notes.push(`Lock of ${lock.registrationNumber} not applied: the bus is not eligible today`);
      continue;
    }
    const block = open
      .filter((b) => b.routeNames.length === 1 && b.routeNames[0] === lock.routeName)
      .sort((a, b) => b.workMinutes - a.workMinutes || a.startMin - b.startMin || compareText(a.id, b.id))[0];
    if (block === undefined) {
      notes.push(`Lock of ${lock.registrationNumber} to ${lock.routeName} not applied: no block runs that route alone`);
      continue;
    }
    locked.push({ blockId: block.id, registrationNumber: bus.registrationNumber, reason: 'locked', busStanding: null });
    open = open.filter((b) => b.id !== block.id);
    buses = buses.filter((b) => b.registrationNumber !== bus.registrationNumber);
  }
  let plan = assignDuties(blocksAsDuties(open, input.depot.id), buses, input.fleet, options);
  let kept = open;
  if (plan.unassignedDuties > 0) {
    const eligible = buses.length - plan.excluded.length;
    kept = open.slice(0, Math.max(0, eligible));
    plan = assignDuties(blocksAsDuties(kept, input.depot.id), buses, input.fleet, options);
  }
  const matched: BlockAssignment[] = plan.assignments.map((a) => ({
    blockId: a.dutyId,
    registrationNumber: a.registrationNumber,
    reason: a.reason,
    busStanding: a.busStanding,
  }));
  const inPlan = [...kept, ...blocks.filter((b) => locked.some((l) => l.blockId === b.id))].sort(byBlockOrder);
  const order = new Map(inPlan.map((b, i) => [b.id, i] as const));
  return {
    assignment: {
      assignments: [...locked, ...matched].sort((a, b) => (order.get(a.blockId) ?? 0) - (order.get(b.blockId) ?? 0)),
      spareBuses: plan.spareBuses,
      spareByStanding: plan.spareByStanding,
      excluded: [
        ...[...held].map(([registrationNumber, reason]) => ({ registrationNumber, reason })),
        ...plan.excluded,
      ].sort((a, b) => compareText(a.registrationNumber, b.registrationNumber)),
      blocksWithoutBus: plan.unassignedDuties,
      locksApplied: locked.length,
    },
    blocks: inPlan,
    droppedBlocks: open.length - kept.length,
    heldOut: held.size,
  };
}
