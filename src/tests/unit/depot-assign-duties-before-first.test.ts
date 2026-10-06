import { describe, expect, it } from 'vitest';
import type { DepotBusView } from '@/lib/depot/api';
import type { Duty, PlanNow } from '@/lib/depot/duties/types';
import type { BusLocation } from '@/lib/depot/infer/types';
import { assignDuties } from '@/lib/depot/optimise/assignDuties';
import type { ModelledBus } from '@/lib/depot/sim/types';
import type { BusOpState } from '@/lib/depot/types';
import { SeededRandom } from '@/lib/simulation/seededRandom';

/*
 * Before the first duty of the feed's date every eligible bus can
 * take a duty (eligible as on the feed clock). The buses standing in the yard
 * leave first, so they hold the earliest duties; the buses still out take the
 * ones after. Route and class rank below that, then wear; there is no time fit.
 */

const BEFORE: PlanNow = { kind: 'before_first_duty' };

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

function duty(id: string, routeName: string, startMin: number): Duty {
  return {
    id, depotId: 'D', routeName, startMin, endMin: startMin + 480, serviceClass: 'ordinary',
    provenance: 'modelled',
  };
}

const NO_FLEET = new Map<string, ModelledBus>();
const busOf = (plan: ReturnType<typeof assignDuties>): Record<string, string | null> =>
  Object.fromEntries(plan.assignments.map((a) => [a.dutyId, a.registrationNumber]));

describe('before the first duty', () => {
  it('gives the yard buses the earliest duties even against the live route', () => {
    const duties = [duty('1', 'A', 300), duty('2', 'A', 310), duty('3', 'B', 320), duty('4', 'B', 330)];
    const buses = [
      bus('R1', 'in_service', 'A', 'away'),
      bus('R2', 'on_road', 'A', 'away'),
      bus('Y1', 'standing', 'B'),
      bus('Y2', 'standing', 'B'),
    ];
    const plan = assignDuties(duties, buses, NO_FLEET, { now: BEFORE });
    const of = busOf(plan);
    expect(new Set([of['1'], of['2']])).toEqual(new Set(['Y1', 'Y2']));
    expect(new Set([of['3'], of['4']])).toEqual(new Set(['R1', 'R2']));
    expect(plan.unassignedDuties).toBe(0);
    expect(plan.excluded).toEqual([]);
  });

  it('runs only yard buses when there are fewer duties than yard buses', () => {
    const duties = [duty('1', 'A', 300), duty('2', 'A', 400)];
    const buses = [
      bus('R1', 'in_service', 'A', 'away'),
      bus('R2', 'on_road', 'A', 'away'),
      bus('R3', 'in_service', 'A', 'away'),
      bus('Y1', 'standing'),
      bus('Y2', 'standing'),
      bus('Y3', 'standing'),
    ];
    const plan = assignDuties(duties, buses, NO_FLEET, { now: BEFORE });
    for (const reg of Object.values(busOf(plan))) expect(reg).toMatch(/^Y/);
    expect(plan.spareByStanding).toEqual({ inYard: 1, standing: 0, onRoad: 3 });
  });

  it('ranks the buses still out after the yard and by route, not by being in service', () => {
    const duties = [duty('1', 'A', 300), duty('2', 'B', 400)];
    const buses = [
      bus('Y', 'standing'),
      bus('S', 'in_service', 'Z', 'away'),
      bus('M', 'on_road', 'B', 'away'),
    ];
    const of = busOf(assignDuties(duties, buses, NO_FLEET, { now: BEFORE }));
    expect(of).toEqual({ '1': 'Y', '2': 'M' });
  });

  it('judges eligibility as on the feed clock: heard recently, not off the road or dark', () => {
    const buses = [
      bus('A', 'in_service', 'R', 'away'),
      bus('B', 'on_road', 'R', 'away', 300),
      bus('C', 'off_road'),
      bus('D', 'dark'),
      bus('E', 'standing', null, 'away'),
      bus('F', 'standing', null, 'in_yard', 300),
    ];
    const plan = assignDuties([duty('1', 'R', 300)], buses, NO_FLEET, { now: BEFORE });
    expect(plan.excluded).toEqual([
      { registrationNumber: 'B', reason: 'not_heard' },
      { registrationNumber: 'C', reason: 'off_road' },
      { registrationNumber: 'D', reason: 'dark' },
      { registrationNumber: 'E', reason: 'not_in_yard' },
      { registrationNumber: 'F', reason: 'not_heard' },
    ]);
    expect(busOf(plan)).toEqual({ '1': 'A' });
  });

  it('with no yard established, a standing bus anywhere leaves first', () => {
    const duties = [duty('1', 'A', 300), duty('2', 'A', 400)];
    const buses = [bus('R', 'in_service', 'A', 'away'), bus('S', 'standing', 'B', 'away')];
    const plan = assignDuties(duties, buses, NO_FLEET, { now: BEFORE, yardEstablished: false });
    expect(busOf(plan)).toEqual({ '1': 'S', '2': 'R' });
  });

  it('keeps the later day to the yard buses', () => {
    const duties = [duty('1', 'A', 300), duty('2', 'A', 400)];
    const buses = [bus('R', 'in_service', 'A', 'away'), bus('Y', 'standing')];
    const plan = assignDuties(duties, buses, NO_FLEET, { now: { kind: 'later_day' } });
    expect(plan.excluded).toEqual([{ registrationNumber: 'R', reason: 'not_in_yard' }]);
    expect(plan.unassignedDuties).toBe(1);
  });

  it('gives the same plan whatever the order of the rows', () => {
    const rng = new SeededRandom('s62b-shuffle');
    const duties = Array.from({ length: 30 }, (_, i) =>
      duty(`d${String(i).padStart(2, '0')}`, `R${i % 4}`, 300 + rng.int(0, 600)),
    ).sort((a, b) => a.startMin - b.startMin || (a.id < b.id ? -1 : 1));
    const buses = Array.from({ length: 40 }, (_, i) =>
      i < 9
        ? bus(`Y${i}`, 'standing', `R${i % 4}`)
        : bus(`R${i}`, i % 2 === 0 ? 'in_service' : 'on_road', `R${i % 5}`, 'away'),
    );
    const plan = assignDuties(duties, buses, NO_FLEET, { now: BEFORE });
    for (let k = 0; k < 5; k += 1) {
      const shuffled = [...buses].sort(() => (rng.bool(0.5) ? 1 : -1));
      expect(assignDuties(duties, shuffled, NO_FLEET, { now: BEFORE })).toEqual(plan);
    }
    // The nine yard buses hold the nine earliest duties.
    const yardDuties = plan.assignments.filter((a) => a.registrationNumber?.startsWith('Y'));
    expect(yardDuties.map((a) => a.dutyId)).toEqual(duties.slice(0, 9).map((d) => d.id));
  });
});
