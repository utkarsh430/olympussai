import { describe, expect, it } from 'vitest';
import { assignDuties } from '@/lib/depot/optimise/assignDuties';
import type { Duty } from '@/lib/depot/duties/types';
import type { DepotBusView } from '@/lib/depot/api';
import type { ModelledBus, ServiceClass } from '@/lib/depot/sim/types';
import type { BusOpState } from '@/lib/depot/types';
import type { BusLocation } from '@/lib/depot/infer/types';

function bus(
  reg: string,
  state: BusOpState = 'standing',
  location: BusLocation = 'in_yard',
): DepotBusView {
  return { registrationNumber: reg, state, location } as unknown as DepotBusView;
}

function duty(i: number, serviceClass: ServiceClass = 'ordinary', hours = 8): Duty {
  const startMin = 300 + i * 10;
  return {
    id: `D-${String(i).padStart(3, '0')}`,
    depotId: 'D',
    routeName: 'R',
    startMin,
    endMin: startMin + hours * 60,
    serviceClass,
    provenance: 'modelled',
  };
}

function fleetOf(entries: readonly [string, ServiceClass, number][]): Map<string, ModelledBus> {
  return new Map(
    entries.map(([reg, serviceClass, ageYears]) => [
      reg,
      { registrationNumber: reg, serviceClass, ageYears, seats: 40 },
    ]),
  );
}

describe('assignDuties', () => {
  it('excludes buses before matching, with the reason by precedence', () => {
    const buses = [
      bus('A', 'off_road', 'away'),
      bus('B', 'dark', 'away'),
      bus('C', 'standing', 'away'),
      bus('D', 'standing', 'at_other_yard'),
      bus('E', 'in_service', 'unknown'),
      bus('F'),
    ];
    const plan = assignDuties([duty(0), duty(1)], buses, fleetOf([]));
    expect(plan.excluded).toEqual([
      { registrationNumber: 'A', reason: 'off_road' },
      { registrationNumber: 'B', reason: 'dark' },
      { registrationNumber: 'C', reason: 'not_in_yard' },
      { registrationNumber: 'D', reason: 'not_in_yard' },
      { registrationNumber: 'E', reason: 'not_in_yard' },
    ]);
    expect(plan.assignments[0]).toEqual({
      dutyId: 'D-000',
      registrationNumber: 'F',
      reason: 'assigned',
    });
    expect(plan.assignments[1]).toEqual({
      dutyId: 'D-001',
      registrationNumber: null,
      reason: 'no_eligible_bus',
    });
    expect(plan.unassignedDuties).toBe(1);
    expect(plan.spareBuses).toEqual([]);
  });

  it('never assigns a class mismatch and treats a bus missing from the fleet as ordinary', () => {
    const fleet = fleetOf([['X1', 'express', 3]]);
    const plan = assignDuties(
      [duty(0, 'ordinary'), duty(1, 'express')],
      [bus('X1'), bus('Y')],
      fleet,
    );
    expect(plan.assignments.map((a) => a.registrationNumber)).toEqual(['Y', 'X1']);
    const lone = assignDuties([duty(0, 'premium')], [bus('Y'), bus('X1')], fleet);
    expect(lone.assignments[0]?.reason).toBe('no_eligible_bus');
    expect(lone.spareBuses).toEqual(['X1', 'Y']);
    expect(lone.excluded).toEqual([]);
  });

  it('gives longer duties the younger buses at minimum total cost', () => {
    const fleet = fleetOf([
      ['OLD', 'ordinary', 12],
      ['NEW', 'ordinary', 1],
    ]);
    const plan = assignDuties(
      [duty(0, 'ordinary', 14), duty(1, 'ordinary', 4)],
      [bus('OLD'), bus('NEW')],
      fleet,
    );
    expect(plan.assignments.map((a) => a.registrationNumber)).toEqual(['NEW', 'OLD']);
  });

  it('with more duties than eligible buses leaves exactly the difference unassigned', () => {
    const duties = Array.from({ length: 9 }, (_, i) => duty(i));
    const buses = [bus('A'), bus('B'), bus('C'), bus('D', 'off_road')];
    const plan = assignDuties(duties, buses, fleetOf([]));
    expect(plan.unassignedDuties).toBe(6);
    expect(plan.assignments).toHaveLength(9);
    const used = plan.assignments.map((a) => a.registrationNumber).filter((r) => r !== null);
    expect(new Set(used).size).toBe(3);
    expect(plan.spareBuses).toEqual([]);
  });

  it('lists eligible buses without a duty as spare, sorted', () => {
    const plan = assignDuties([duty(0)], [bus('C'), bus('A'), bus('B')], fleetOf([]));
    expect(plan.spareBuses).toHaveLength(2);
    expect([...plan.spareBuses].sort()).toEqual(plan.spareBuses);
  });

  it('never uses an excluded or class-mismatched bus, and never a bus twice (random)', () => {
    const classes: ServiceClass[] = ['ordinary', 'express', 'ac', 'premium'];
    const states: BusOpState[] = ['standing', 'off_road', 'dark', 'on_road'];
    const locs: BusLocation[] = ['in_yard', 'in_yard', 'away', 'unknown'];
    const entries: [string, ServiceClass, number][] = [];
    const buses: DepotBusView[] = [];
    for (let i = 0; i < 40; i += 1) {
      const reg = `B${String(i).padStart(2, '0')}`;
      entries.push([reg, classes[i % 4] ?? 'ordinary', (i * 7) % 15]);
      buses.push(bus(reg, states[(i * 3) % 4], locs[(i * 5) % 4]));
    }
    const fleet = fleetOf(entries);
    const duties = Array.from({ length: 30 }, (_, i) =>
      duty(i, classes[(i * 2) % 4] ?? 'ordinary', 4 + (i % 9)),
    );
    const plan = assignDuties(duties, buses, fleet);
    const excluded = new Set(plan.excluded.map((e) => e.registrationNumber));
    const taken = plan.assignments.flatMap((a) =>
      a.registrationNumber ? [a.registrationNumber] : [],
    );
    expect(new Set(taken).size).toBe(taken.length);
    for (const a of plan.assignments) {
      if (a.registrationNumber === null) continue;
      expect(excluded.has(a.registrationNumber)).toBe(false);
      const d = duties.find((x) => x.id === a.dutyId);
      expect(fleet.get(a.registrationNumber)?.serviceClass).toBe(d?.serviceClass);
    }
    expect(plan.unassignedDuties).toBe(
      plan.assignments.filter((a) => a.registrationNumber === null).length,
    );
  });

  it('throws when a registration appears twice', () => {
    expect(() => assignDuties([duty(0)], [bus('A'), bus('A')], fleetOf([]))).toThrow(RangeError);
  });

  it('costs a bus missing from the fleet master at the median age, not zero', () => {
    const fleet = fleetOf([
      ['K02', 'ordinary', 2],
      ['K10', 'ordinary', 10],
      ['K30', 'ordinary', 30],
    ]);
    const buses = [bus('K02'), bus('K10'), bus('K30'), bus('AAA')];
    expect(
      assignDuties([duty(0, 'ordinary', 10)], buses, fleet).assignments[0]?.registrationNumber,
    ).toBe('K02');
  });

  it('copes with an empty fleet master by costing every bus alike', () => {
    const plan = assignDuties([duty(0)], [bus('B'), bus('A')], fleetOf([]));
    expect(plan.assignments[0]?.registrationNumber).toBe('A');
    expect(plan.spareBuses).toEqual(['B']);
  });

  it('ignores non-finite ages when taking the median', () => {
    // The finite ages are 2 and 10, so unknown buses cost as age 6; the NaN must not poison it.
    const fleet = fleetOf([
      ['N1', 'ordinary', Number.NaN],
      ['C', 'ordinary', 10],
      ['N2', 'ordinary', Number.NaN],
      ['B', 'ordinary', 2],
      ['N3', 'ordinary', Number.NaN],
    ]);
    const buses = [bus('B'), bus('C'), bus('UNKNOWN')];
    const plan = assignDuties([duty(0, 'ordinary', 10)], buses, fleet);
    expect(plan.assignments[0]?.registrationNumber).toBe('B');
    // Between age 2 (B) and age 10 (C), an unknown bus at age 6 is picked before C for a short duty.
    const two = assignDuties([duty(0, 'ordinary', 10), duty(1, 'ordinary', 1)], buses, fleet);
    expect(two.assignments.map((a) => a.registrationNumber)).toEqual(['B', 'UNKNOWN']);
  });

  it('costs an eligible bus whose own age is non-finite at the fallback age', () => {
    const fleet = fleetOf([
      ['B', 'ordinary', 2],
      ['C', 'ordinary', 10],
      ['N', 'ordinary', Number.NaN],
    ]);
    const plan = assignDuties([duty(0, 'ordinary', 10)], [bus('N'), bus('C')], fleet);
    expect(plan.assignments[0]?.registrationNumber).toBe('N');
  });

  it('falls back as for an empty master when every age is non-finite', () => {
    const fleet = fleetOf([
      ['B', 'ordinary', Number.NaN],
      ['A', 'ordinary', Number.POSITIVE_INFINITY],
    ]);
    const plan = assignDuties([duty(0)], [bus('Z'), bus('Y')], fleet);
    expect(plan.assignments[0]?.registrationNumber).toBe('Y');
    expect(plan.spareBuses).toEqual(['Z']);
  });

  it('is identical for shuffled buses and does not mutate frozen inputs', () => {
    const buses = Array.from({ length: 12 }, (_, i) => bus(`Q${i}`));
    const fleet = fleetOf(buses.map((b, i) => [b.registrationNumber, 'ordinary', i % 4]));
    const duties = Array.from({ length: 8 }, (_, i) => duty(i, 'ordinary', 5 + i));
    const frozenBuses = Object.freeze(buses.map((b) => Object.freeze(b)));
    const a = assignDuties(Object.freeze(duties), frozenBuses, fleet);
    const b = assignDuties(duties, [...buses].reverse(), fleet);
    expect(b).toEqual(a);
  });
});

describe('assignDuties with no yard established', () => {
  const NO_YARD = { yardEstablished: false } as const;
  const heard = (reg: string, state: BusOpState, gpsAgeMin: number | null): DepotBusView =>
    ({
      registrationNumber: reg,
      state,
      location: 'unknown',
      gpsAgeMin,
      notHeardMin: gpsAgeMin !== null && gpsAgeMin > 30 ? gpsAgeMin : null,
    }) as unknown as DepotBusView;

  it('makes a standing bus with a recent report eligible though its location is unknown', () => {
    const buses = [heard('A', 'standing', 2), heard('B', 'standing', 30), heard('C', 'standing', 0)];
    const plan = assignDuties([duty(0), duty(1)], buses, fleetOf([]), NO_YARD);
    expect(plan.unassignedDuties).toBe(0);
    expect(plan.spareBuses).toHaveLength(1);
    expect(plan.excluded).toEqual([]);
  });

  it('still holds out off-road, dark, moving, quiet and clockless buses, one reason each', () => {
    const buses = [
      heard('X', 'off_road', 2),
      heard('D', 'dark', 2),
      heard('M', 'on_road', 2),
      heard('S', 'in_service', 2),
      heard('Q', 'standing', 45),
      heard('N', 'standing', null),
    ];
    const plan = assignDuties([duty(0)], buses, fleetOf([]), NO_YARD);
    expect(plan.unassignedDuties).toBe(1);
    expect(plan.excluded).toEqual([
      { registrationNumber: 'D', reason: 'dark' },
      { registrationNumber: 'M', reason: 'not_in_yard' },
      { registrationNumber: 'N', reason: 'not_in_yard' },
      { registrationNumber: 'Q', reason: 'not_in_yard' },
      { registrationNumber: 'S', reason: 'not_in_yard' },
      { registrationNumber: 'X', reason: 'off_road' },
    ]);
  });

  it('changes nothing when a yard exists: location still decides', () => {
    const buses = [heard('A', 'standing', 2), bus('B'), bus('C', 'standing', 'away')];
    const withYard = assignDuties([duty(0), duty(1)], buses, fleetOf([]), { yardEstablished: true });
    expect(withYard).toEqual(assignDuties([duty(0), duty(1)], buses, fleetOf([])));
    expect(withYard.excluded.map((e) => e.registrationNumber)).toEqual(['A', 'C']);
    expect(withYard.unassignedDuties).toBe(1);
  });
});
