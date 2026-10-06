import { describe, expect, it } from 'vitest';
import { planParking } from '@/lib/depot/optimise/parkingOrder';
import { modelYardLayout } from '@/lib/depot/sim/yardLayout';
import type { Lane, ParkingSlot } from '@/lib/depot/duties/types';
import type { DepotSummary } from '@/lib/depot/types';
import { SeededRandom } from '@/lib/simulation/seededRandom';

const depot = (id: string): DepotSummary => ({ id, name: id }) as unknown as DepotSummary;
type Input = { registrationNumber: string; firstDutyStartMin: number | null };

const key = (m: number | null): number => (m === null ? Infinity : m);

/** Departure times must not decrease from the mouth to the back of a lane. */
function expectNoneBlocked(slots: readonly ParkingSlot[]): void {
  const byLane = new Map<string, ParkingSlot[]>();
  for (const s of slots) byLane.set(s.laneId, [...(byLane.get(s.laneId) ?? []), s]);
  for (const lane of byLane.values()) {
    const fromMouth = [...lane].sort((a, b) => b.position - a.position);
    for (let i = 1; i < fromMouth.length; i += 1) {
      expect(key(fromMouth[i].firstDutyStartMin)).toBeGreaterThanOrEqual(
        key(fromMouth[i - 1].firstDutyStartMin),
      );
    }
  }
}

function randomCase(seed: string): { lanes: Lane[]; buses: Input[] } {
  const rng = new SeededRandom(seed);
  const lanes = Array.from({ length: rng.int(1, 8) }, (_, i) => ({
    id: `L${String(i + 1).padStart(2, '0')}`,
    depth: rng.int(1, 10),
  }));
  const capacity = lanes.reduce((s, l) => s + l.depth, 0);
  const count = rng.int(0, capacity + 6);
  const buses = Array.from({ length: count }, (_, i) => ({
    registrationNumber: `MH-${String(i).padStart(3, '0')}`,
    firstDutyStartMin: rng.float(0, 1) < 0.25 ? null : 240 + 5 * rng.int(0, 150),
  }));
  return { lanes, buses };
}

describe('planParking', () => {
  it('has zero blocked buses, every bus once, within depth, over random seeded inputs', () => {
    for (let t = 0; t < 300; t += 1) {
      const { lanes, buses } = randomCase(`park-${t}`);
      const capacity = lanes.reduce((s, l) => s + l.depth, 0);
      const plan = planParking(lanes, buses);
      expect(plan.blocked).toBe(0);
      expectNoneBlocked(plan.slots);
      const placed = plan.slots.map((s) => s.registrationNumber);
      const all = [...placed, ...plan.overflow].sort();
      expect(all).toEqual(buses.map((b) => b.registrationNumber).sort());
      expect(new Set(placed).size).toBe(placed.length);
      expect(plan.overflow).toHaveLength(Math.max(0, buses.length - capacity));
      for (const lane of lanes) {
        const here = plan.slots.filter((s) => s.laneId === lane.id);
        expect(here.length).toBeLessThanOrEqual(lane.depth);
        const positions = here.map((s) => s.position).sort((a, b) => a - b);
        expect(positions).toEqual(positions.map((_, i) => i));
      }
      expect([...plan.overflow].sort()).toEqual(plan.overflow);
    }
  });

  it('overflows only the latest-or-no-duty buses and parks the earliest first', () => {
    const lanes = [{ id: 'L01', depth: 3 }];
    const buses: Input[] = [
      { registrationNumber: 'N1', firstDutyStartMin: null },
      { registrationNumber: 'E1', firstDutyStartMin: 300 },
      { registrationNumber: 'M1', firstDutyStartMin: 600 },
      { registrationNumber: 'E2', firstDutyStartMin: 310 },
      { registrationNumber: 'L1', firstDutyStartMin: 1000 },
    ];
    const plan = planParking(lanes, buses);
    expect(plan.overflow).toEqual(['L1', 'N1']);
    expect(plan.slots.map((s) => s.registrationNumber).sort()).toEqual(['E1', 'E2', 'M1']);
    expect(plan.blocked).toBe(0);
  });

  it('puts the earliest departures at the mouths of different lanes', () => {
    const lanes = [
      { id: 'L01', depth: 4 },
      { id: 'L02', depth: 4 },
      { id: 'L03', depth: 4 },
    ];
    const buses: Input[] = [300, 310, 320, 330, 340, 350].map((m, i) => ({
      registrationNumber: `B${i}`,
      firstDutyStartMin: m,
    }));
    const plan = planParking(lanes, buses);
    const mouths = plan.slots.filter((s) => {
      const lane = plan.slots.filter((x) => x.laneId === s.laneId);
      return s.position === lane.length - 1;
    });
    expect(mouths.map((s) => s.registrationNumber).sort()).toEqual(['B0', 'B1', 'B2']);
    expect(new Set(mouths.map((s) => s.laneId)).size).toBe(3);
  });

  it('places buses with no duty deepest', () => {
    const lanes = [{ id: 'L01', depth: 3 }];
    const plan = planParking(lanes, [
      { registrationNumber: 'A', firstDutyStartMin: null },
      { registrationNumber: 'B', firstDutyStartMin: 400 },
      { registrationNumber: 'C', firstDutyStartMin: 300 },
    ]);
    const at = Object.fromEntries(plan.slots.map((s) => [s.registrationNumber, s.position]));
    expect(at).toEqual({ A: 0, B: 1, C: 2 });
  });

  it('handles empty input and empty lanes', () => {
    expect(planParking([], [])).toEqual({ slots: [], blocked: 0, overflow: [] });
    expect(planParking([], [{ registrationNumber: 'A', firstDutyStartMin: 300 }]).overflow).toEqual([
      'A',
    ]);
    expect(planParking([{ id: 'L01', depth: 2 }], []).slots).toEqual([]);
  });

  it('is identical for shuffled input and does not mutate frozen input', () => {
    const { lanes, buses } = randomCase('park-shuffle');
    const frozenLanes = Object.freeze(lanes.map((l) => Object.freeze(l)));
    const frozenBuses = Object.freeze(buses.map((b) => Object.freeze(b)));
    const a = planParking(frozenLanes, frozenBuses);
    const b = planParking([...lanes].reverse(), [...buses].reverse());
    expect(b).toEqual(a);
  });

  it('rejects bad lane depths and duplicate registrations', () => {
    expect(() => planParking([{ id: 'L01', depth: 0 }], [])).toThrow(RangeError);
    expect(() => planParking([{ id: 'L01', depth: 2.5 }], [])).toThrow(RangeError);
    expect(() =>
      planParking(
        [{ id: 'L01', depth: 2 }],
        [
          { registrationNumber: 'A', firstDutyStartMin: 1 },
          { registrationNumber: 'A', firstDutyStartMin: 2 },
        ],
      ),
    ).toThrow(RangeError);
  });
});

describe('modelYardLayout', () => {
  it('gives no lanes for zero capacity', () => {
    expect(modelYardLayout(depot('D1'), 0)).toEqual([]);
  });

  it('sums exactly to capacity with ids L01.. and depths 6-10 (last may be shorter)', () => {
    for (const capacity of [1, 5, 6, 37, 120, 333]) {
      const lanes = modelYardLayout(depot('D1'), capacity);
      expect(lanes.reduce((s, l) => s + l.depth, 0)).toBe(capacity);
      lanes.forEach((l, i) => {
        expect(l.id).toBe(`L${String(i + 1).padStart(2, '0')}`);
        expect(l.depth).toBeLessThanOrEqual(10);
        if (i < lanes.length - 1) expect(l.depth).toBeGreaterThanOrEqual(6);
      });
    }
  });

  it('is deterministic per depot id and does not depend on capacity for existing lanes', () => {
    const a = modelYardLayout(depot('D1'), 200);
    expect(modelYardLayout(depot('D1'), 200)).toEqual(a);
    const smaller = modelYardLayout(depot('D1'), 100);
    expect(smaller.slice(0, -1)).toEqual(a.slice(0, smaller.length - 1));
    expect(modelYardLayout(depot('D2'), 200)).not.toEqual(a);
  });

  it('rejects a negative or fractional capacity', () => {
    expect(() => modelYardLayout(depot('D1'), -1)).toThrow(RangeError);
    expect(() => modelYardLayout(depot('D1'), 2.5)).toThrow(RangeError);
  });
});
