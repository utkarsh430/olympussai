import { describe, expect, it } from 'vitest';
import type { DepotBusView } from '@/lib/depot/api';
import type { Duty } from '@/lib/depot/duties/types';
import type { BusLocation } from '@/lib/depot/infer/types';
import { assignDuties } from '@/lib/depot/optimise/assignDuties';
import type { ModelledBus, ServiceClass } from '@/lib/depot/sim/types';
import type { BusOpState } from '@/lib/depot/types';

/*
 * One matcher, its eligibility and its cost tiers, and the
 * way each assigned bus stands now.
 */

function bus(
  reg: string,
  state: BusOpState,
  routeName: string | null = null,
  location: BusLocation = 'in_yard',
  gpsAgeMin = 1,
): DepotBusView {
  return { registrationNumber: reg, state, location, routeName, gpsAgeMin, notHeardMin: null } as
    unknown as DepotBusView;
}

function duty(id: string, routeName: string, startMin = 300, cls: ServiceClass = 'ordinary'): Duty {
  return {
    id, depotId: 'D', routeName, startMin, endMin: startMin + 480, serviceClass: cls,
    provenance: 'modelled',
  };
}

function fleetOf(entries: readonly [string, ServiceClass][]): Map<string, ModelledBus> {
  return new Map(
    entries.map(([reg, serviceClass]) => [reg, { registrationNumber: reg, serviceClass, ageYears: 5, seats: 40 }]),
  );
}

const busOf = (plan: ReturnType<typeof assignDuties>): Record<string, string | null> =>
  Object.fromEntries(plan.assignments.map((a) => [a.dutyId, a.registrationNumber]));

describe('assignDuties eligibility', () => {
  it('takes buses in service or on the road wherever they are; never off the road or dark', () => {
    const buses = [
      bus('A', 'in_service', 'R', 'away'),
      bus('B', 'on_road', null, 'unknown'),
      bus('C', 'off_road'),
      bus('D', 'dark'),
      bus('E', 'standing', null, 'away'),
    ];
    const plan = assignDuties([duty('1', 'R'), duty('2', 'R'), duty('3', 'R')], buses, fleetOf([]));
    expect(plan.excluded).toEqual([
      { registrationNumber: 'C', reason: 'off_road' },
      { registrationNumber: 'D', reason: 'dark' },
      { registrationNumber: 'E', reason: 'not_in_yard' },
    ]);
    expect(new Set(Object.values(busOf(plan)))).toEqual(new Set(['A', 'B', null]));
  });

  it('with a yard, a standing bus on an old report is not heard recently though it reported the yard', () => {
    const plan = assignDuties([duty('1', 'R')], [bus('A', 'standing', null, 'in_yard', 300)], fleetOf([]), {
      now: { kind: 'feed_time', feedMinute: 600 },
    });
    expect(plan.excluded).toEqual([{ registrationNumber: 'A', reason: 'not_heard' }]);
    expect(plan.unassignedDuties).toBe(1);
  });

  it('without a yard, a standing bus on an old report is not eligible either', () => {
    const plan = assignDuties([duty('1', 'R')], [bus('A', 'standing', null, 'unknown', 300)], fleetOf([]), {
      yardEstablished: false,
      now: { kind: 'feed_time', feedMinute: 600 },
    });
    expect(plan.excluded).toEqual([{ registrationNumber: 'A', reason: 'not_heard' }]);
  });
});

describe('assignDuties cost tiers', () => {
  it('1: keeps buses on the road in the day, even off their route and class', () => {
    const buses = [
      bus('A', 'standing', 'R'),
      bus('B', 'standing', 'R'),
      bus('C', 'standing', 'R'),
      bus('Z', 'in_service', 'X'),
    ];
    const fleet = fleetOf([['A', 'ordinary'], ['B', 'ordinary'], ['C', 'ordinary'], ['Z', 'express']]);
    const plan = assignDuties([duty('1', 'R'), duty('2', 'R'), duty('3', 'R')], buses, fleet);
    expect(Object.values(busOf(plan))).toContain('Z');
    expect(plan.spareBuses).toHaveLength(1);
  });

  it('2: a bus reporting a route live takes that route’s duty', () => {
    const buses = [bus('A', 'in_service', 'R2'), bus('B', 'in_service', 'R1')];
    const plan = assignDuties([duty('1', 'R1'), duty('2', 'R2')], buses, fleetOf([]));
    expect(busOf(plan)).toEqual({ '1': 'B', '2': 'A' });
  });

  it('3: matches class where it can, and uses another class rather than leave a duty idle', () => {
    const fleet = fleetOf([['A', 'express'], ['B', 'ordinary']]);
    const buses = [bus('A', 'standing'), bus('B', 'standing')];
    const plan = assignDuties([duty('1', 'R', 300, 'ordinary'), duty('2', 'R', 300, 'express')], buses, fleet);
    expect(busOf(plan)).toEqual({ '1': 'B', '2': 'A' });
    const short = assignDuties([duty('1', 'R', 300, 'ordinary')], [bus('A', 'standing')], fleet);
    expect(busOf(short)).toEqual({ '1': 'A' });
  });

  it('4: a started duty takes the bus on the road, one still to start the standing bus', () => {
    const buses = [bus('A', 'on_road'), bus('B', 'standing')];
    const duties = [duty('early', 'R', 300), duty('late', 'R', 900)];
    const plan = assignDuties(duties, buses, fleetOf([]), { now: { kind: 'feed_time', feedMinute: 600 } });
    expect(busOf(plan)).toEqual({ early: 'A', late: 'B' });
    const swapped = assignDuties(duties, [bus('A', 'standing'), bus('B', 'on_road')], fleetOf([]), {
      now: { kind: 'feed_time', feedMinute: 600 },
    });
    expect(busOf(swapped)).toEqual({ early: 'B', late: 'A' });
  });
});

describe('assignDuties tier weights hold at a large depot', () => {
  it('keeps every bus in service in the day at 300 buses and 250 duties', () => {
    const buses = Array.from({ length: 300 }, (_, i) =>
      bus(`B${String(i).padStart(3, '0')}`, i % 3 === 0 ? 'in_service' : 'standing', `R${i % 7}`),
    );
    const duties = Array.from({ length: 250 }, (_, i) => duty(`D${i}`, `R${i % 5}`, 240 + (i % 60) * 10));
    const plan = assignDuties(duties, buses, fleetOf([]), { now: { kind: 'feed_time', feedMinute: 600 } });
    const taken = new Set(plan.assignments.map((a) => a.registrationNumber));
    for (const b of buses) if (b.state === 'in_service') expect(taken.has(b.registrationNumber)).toBe(true);
    expect(plan.unassignedDuties).toBe(0);
  });
});

describe('assignDuties records how each bus stands now', () => {
  it('on the road, in the yard, or standing where no yard is established; null without a bus', () => {
    const plan = assignDuties(
      [duty('1', 'R'), duty('2', 'R'), duty('3', 'R')],
      [bus('A', 'on_road'), bus('B', 'standing')],
      fleetOf([]),
    );
    expect(new Set(plan.assignments.map((a) => a.busStanding))).toEqual(
      new Set(['in_yard', 'on_road', null]),
    );
    const noYard = assignDuties([duty('1', 'R')], [bus('B', 'standing', null, 'unknown')], fleetOf([]), {
      yardEstablished: false,
    });
    expect(noYard.assignments[0]?.busStanding).toBe('standing');
  });
});
