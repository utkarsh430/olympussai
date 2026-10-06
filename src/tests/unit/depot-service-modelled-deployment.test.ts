// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Duty } from '@/lib/depot/duties/types';
import { modelledRouteHours } from '@/lib/depot/service/modelledDeployment';
import type { DayRun, OperatingDay } from '@/lib/depot/sim/operatingDayTypes';

const DATE = '2026-10-06';

function duty(id: string, routeName: string, startMin: number, endMin: number): Duty {
  return {
    id,
    depotId: 'D1',
    routeName,
    startMin,
    endMin,
    serviceClass: 'ordinary',
    provenance: 'modelled',
  };
}

function run(dutyId: string, routeName: string): DayRun {
  return {
    dutyId,
    routeName,
    registrationNumber: `UP${dutyId}`,
    dutyClass: 'ordinary',
    busClass: 'ordinary',
    classMatched: true,
    seats: 52,
    distanceKm: 80,
  };
}

function dayOf(duties: readonly Duty[], ranIds: readonly string[]): OperatingDay {
  return {
    depotId: 'D1',
    operatingDate: DATE,
    duties,
    routesWithoutDuty: [],
    routes: [],
    runs: duties.filter((d) => ranIds.includes(d.id)).map((d) => run(d.id, d.routeName)),
    notRun: [],
    fleet: 10,
    availableBuses: 10,
    dutiesWithoutBus: 0,
    provenance: 'modelled',
  };
}

describe('modelledRouteHours', () => {
  const duties = [
    duty('a', 'R1', 6 * 60, 8 * 60 + 30), // 06:00 to 08:30
    duty('b', 'R1', 7 * 60 + 30, 9 * 60), // 07:30 to 09:00
    duty('c', 'R1', 7 * 60, 10 * 60), // no bus: never ran
    duty('d', 'R2', 7 * 60, 10 * 60), // another route
    duty('e', 'R1', 23 * 60, 25 * 60), // past midnight: only 23:00 to 24:00 counts
  ];
  const hours = modelledRouteHours([dayOf(duties, ['a', 'b', 'd', 'e'])], 'R1', DATE);

  it('answers 24 hours of the route', () => {
    expect(hours.map((h) => h.hour)).toEqual(Array.from({ length: 24 }, (_, i) => i));
    expect(hours.every((h) => h.routeName === 'R1' && h.operatingDate === DATE)).toBe(true);
  });

  it('counts the bus-hours of the duties that ran, per hour', () => {
    expect(hours.slice(5, 10).map((h) => h.deployed)).toEqual([0, 1, 1.5, 1.5, 0]);
    expect(hours[23]?.deployed).toBe(1);
    expect(hours[0]?.deployed).toBe(0);
  });

  it('adds the days of every depot running the route', () => {
    const two = modelledRouteHours(
      [dayOf(duties, ['a']), dayOf([duty('x', 'R1', 6 * 60, 7 * 60)], ['x'])],
      'R1',
      DATE,
    );
    expect(two[6]?.deployed).toBe(2);
  });

  it('ignores a day of another date', () => {
    const other = { ...dayOf(duties, ['a']), operatingDate: '2026-10-05' };
    expect(modelledRouteHours([other], 'R1', DATE).every((h) => h.deployed === 0)).toBe(true);
  });
});
