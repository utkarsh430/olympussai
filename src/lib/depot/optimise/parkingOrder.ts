import type { Lane, ParkingPlan, ParkingSlot } from '../duties/types';

interface ParkingBus {
  readonly registrationNumber: string;
  readonly firstDutyStartMin: number | null;
}

/** A bus with no duty tomorrow leaves last, so it sorts as infinitely late. */
/**
 * Lane ids order by length then text, so L99 precedes L100: ids are padded to
 * two digits only, and a yard of more than 99 lanes must not list L10, L100, L11.
 */
function compareLaneIds(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

function departure(bus: ParkingBus): number {
  return bus.firstDutyStartMin ?? Infinity;
}

function byDepartureThenRegistration(a: ParkingBus, b: ParkingBus): number {
  const d = departure(a) === departure(b) ? 0 : departure(a) < departure(b) ? -1 : 1;
  if (d !== 0) return d;
  return a.registrationNumber < b.registrationNumber
    ? -1
    : a.registrationNumber > b.registrationNumber
      ? 1
      : 0;
}

function validate(lanes: readonly Lane[], buses: readonly ParkingBus[]): void {
  const ids = new Set<string>();
  for (const lane of lanes) {
    if (!Number.isInteger(lane.depth) || lane.depth < 1) {
      throw new RangeError(`Lane ${lane.id} depth must be a positive integer, got ${lane.depth}`);
    }
    if (ids.has(lane.id)) throw new RangeError(`Duplicate lane id ${lane.id}`);
    ids.add(lane.id);
  }
  const regs = new Set<string>();
  for (const bus of buses) {
    if (regs.has(bus.registrationNumber)) {
      throw new RangeError(`Duplicate registration ${bus.registrationNumber}`);
    }
    regs.add(bus.registrationNumber);
    if (bus.firstDutyStartMin !== null && !Number.isFinite(bus.firstDutyStartMin)) {
      throw new RangeError(
        `Bus ${bus.registrationNumber} first duty start must be finite or null, got ${bus.firstDutyStartMin}`,
      );
    }
  }
}

/** How many buses each lane takes: one at a time round-robin, skipping full lanes. */
function laneFills(depths: readonly number[], count: number): number[] {
  const fills = depths.map(() => 0);
  let left = count;
  while (left > 0) {
    depths.forEach((depth, i) => {
      const filled = fills[i] ?? 0;
      if (left > 0 && filled < depth) {
        fills[i] = filled + 1;
        left -= 1;
      }
    });
  }
  return fills;
}

/** Counts buses with a later-leaving bus nearer the mouth of the same lane. */
function countBlocked(slots: readonly ParkingSlot[]): number {
  let blocked = 0;
  for (const slot of slots) {
    const late = departure(slot);
    if (
      slots.some(
        (o) => o.laneId === slot.laneId && o.position > slot.position && departure(o) > late,
      )
    ) {
      blocked += 1;
    }
  }
  return blocked;
}

/**
 * The night parking order: how the yard should be parked so the first bus out
 * is never boxed in. Position 0 is the back of a lane, the highest is its
 * mouth, and a lane empties from the mouth.
 *
 * Which buses fit: when buses exceed total depth, those with the earliest
 * first duties are parked first and the latest, then no-duty, buses overflow
 * (ties by registration), so overflow is exactly `buses - capacity`.
 * Distribution: the parked buses are spread round-robin across lanes (taken in
 * id order, skipping full ones) so lane loads differ by at most one unless a
 * lane is shallower. Buses are then dealt in ascending departure order layer by
 * layer from the mouths: the earliest bus of each lane in turn takes the mouth,
 * the next layer sits behind it, and so on. The earliest departures therefore
 * sit at mouths of different lanes instead of queueing in one, and within
 * every lane departure never decreases from mouth to back, so none is blocked.
 * Ties break by registration; input order never matters. A recommendation only.
 */
export function planParking(lanes: readonly Lane[], buses: readonly ParkingBus[]): ParkingPlan {
  validate(lanes, buses);
  const orderedLanes = [...lanes].sort((a, b) => compareLaneIds(a.id, b.id));
  const capacity = orderedLanes.reduce((sum, lane) => sum + lane.depth, 0);
  const earliestFirst = [...buses].sort(byDepartureThenRegistration);
  const parked = earliestFirst.slice(0, capacity);
  const overflow = earliestFirst
    .slice(capacity)
    .map((b) => b.registrationNumber)
    .sort();

  const fills = laneFills(
    orderedLanes.map((l) => l.depth),
    parked.length,
  );
  const slots: ParkingSlot[] = [];
  let next = 0;
  const layers = Math.max(0, ...fills);
  for (let layer = 0; layer < layers; layer += 1) {
    orderedLanes.forEach((lane, i) => {
      const fill = fills[i] ?? 0;
      const bus = parked[next];
      if (fill <= layer || bus === undefined) return;
      next += 1;
      slots.push({
        laneId: lane.id,
        position: fill - 1 - layer,
        registrationNumber: bus.registrationNumber,
        firstDutyStartMin: bus.firstDutyStartMin,
      });
    });
  }
  slots.sort((a, b) =>
    a.laneId === b.laneId ? a.position - b.position : compareLaneIds(a.laneId, b.laneId),
  );
  return { slots, blocked: countBlocked(slots), overflow };
}
