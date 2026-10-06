import { describe, expect, it } from 'vitest';
import type { DepotBusView } from '@/lib/depot/api';
import type { Duty, PlanNow } from '@/lib/depot/duties/types';
import { assignDuties, MAX_BASE_COST, tierWeights } from '@/lib/depot/optimise/assignDuties';
import type { ModelledBus, ServiceClass } from '@/lib/depot/sim/types';
import type { BusOpState } from '@/lib/depot/types';
import { SeededRandom } from '@/lib/simulation/seededRandom';

/*
 * Ruling S55, review N5 (I2-rest): a bus in service ranks above a bus that is
 * only moving, directly below "keep on-the-road buses in the day". The tiers
 * stay exactly lexicographic: checked here by exhaustive search on small
 * depots, and by the weight bound at 400 duties x 400 buses.
 */

const CLASSES: readonly ServiceClass[] = ['ordinary', 'express', 'ac'];
const STATES: readonly BusOpState[] = ['in_service', 'on_road', 'standing'];
const ROUTES = ['R1', 'R2', 'R3'];
const MINUTES_PER_HOUR = 60;

function bus(reg: string, state: BusOpState, routeName: string | null): DepotBusView {
  return { registrationNumber: reg, state, location: 'in_yard', routeName, gpsAgeMin: 1, notHeardMin: null } as
    unknown as DepotBusView;
}

function duty(id: string, routeName: string, startMin: number, endMin: number, cls: ServiceClass): Duty {
  return { id, depotId: 'D', routeName, startMin, endMin, serviceClass: cls, provenance: 'modelled' };
}

const modelled = (reg: string, serviceClass: ServiceClass, ageYears: number): ModelledBus =>
  ({ registrationNumber: reg, serviceClass, ageYears, seats: 40 }) as ModelledBus;

describe('in service ranks above merely moving (S55, N5)', () => {
  it('runs both buses in service on the duty’s route and leaves the merely moving bus spare', () => {
    const fleet = new Map([
      ['A', modelled('A', 'ordinary', 12)],
      ['B', modelled('B', 'ordinary', 12)],
      ['C', modelled('C', 'ordinary', 1)],
    ]);
    const buses = [bus('A', 'in_service', 'R1'), bus('B', 'in_service', 'R1'), bus('C', 'on_road', 'R1')];
    const duties = [duty('1', 'R1', 300, 900, 'ordinary'), duty('2', 'R1', 300, 900, 'ordinary')];
    const plan = assignDuties(duties, buses, fleet, { now: { kind: 'feed_time', feedMinute: 600 } });
    expect(new Set(plan.assignments.map((a) => a.registrationNumber))).toEqual(new Set(['A', 'B']));
    expect(plan.spareBuses).toEqual(['C']);
  });
});

/** The pair's tiers as the ruling states them, highest first, read off the inputs only. */
function tiersOf(d: Duty, b: DepotBusView, fleet: Map<string, ModelledBus>, now: PlanNow): number[] {
  const onRoad = b.state !== 'standing';
  const feedMinute = now.kind === 'feed_time' ? now.feedMinute : null;
  const started = feedMinute !== null && d.startMin <= feedMinute;
  const m = fleet.get(b.registrationNumber);
  const hours = Math.round((d.endMin - d.startMin) / MINUTES_PER_HOUR);
  return [
    onRoad ? 0 : 1,
    b.state === 'in_service' ? 0 : 1,
    b.routeName === d.routeName ? 0 : 1,
    m?.serviceClass === d.serviceClass ? 0 : 1,
    started === onRoad ? 0 : 1,
    Math.min(MAX_BASE_COST, Math.round((m?.ageYears ?? 0) * hours)),
  ];
}

const add = (a: number[], b: number[]): number[] => a.map((v, i) => v + (b[i] ?? 0));
const lexLess = (a: number[], b: number[]): boolean => {
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return (a[i] ?? 0) < (b[i] ?? 0);
  return false;
};

/** The lexicographically least tier totals over every maximum matching, by exhaustive search. */
function bruteForce(costs: number[][][], buses: number): number[] {
  const rows = costs.length;
  const pairs = Math.min(rows, buses);
  let best: number[] | null = null;
  const used = new Set<number>();
  const walk = (row: number, matched: number, total: number[]): void => {
    if (row === rows) {
      if (matched === pairs && (best === null || lexLess(total, best))) best = total;
      return;
    }
    if (rows - row - 1 >= pairs - matched) walk(row + 1, matched, total);
    for (let col = 0; col < buses; col += 1) {
      if (used.has(col)) continue;
      used.add(col);
      walk(row + 1, matched + 1, add(total, costs[row]?.[col] ?? []));
      used.delete(col);
    }
  };
  walk(0, 0, [0, 0, 0, 0, 0, 0]);
  return best ?? [0, 0, 0, 0, 0, 0];
}

describe('the tiers are exactly lexicographic (exhaustive search)', () => {
  it('matches the exhaustive optimum on 300 random small depots', () => {
    const rng = new SeededRandom('s55-n5');
    for (let n = 0; n < 300; n += 1) {
      const busCount = rng.int(0, 6);
      const dutyCount = rng.int(0, 5);
      const buses = Array.from({ length: busCount }, (_, i) =>
        bus(`B${i}`, rng.pick(STATES), rng.bool(0.8) ? rng.pick(ROUTES) : null),
      );
      const fleet = new Map(buses.map((b) => [b.registrationNumber, modelled(b.registrationNumber, rng.pick(CLASSES), rng.int(0, 15))]));
      const duties = Array.from({ length: dutyCount }, (_, i) => {
        const start = rng.int(48, 200) * 5;
        return duty(`D${i}`, rng.pick(ROUTES), start, start + rng.int(48, 192) * 5, rng.pick(CLASSES));
      });
      const now: PlanNow = rng.bool(0.3) ? { kind: 'no_feed_clock' } : { kind: 'feed_time', feedMinute: rng.int(0, 1439) };
      const costs = duties.map((d) => buses.map((b) => tiersOf(d, b, fleet, now)));
      const plan = assignDuties(duties, buses, fleet, { now });
      const col = new Map(buses.map((b, i) => [b.registrationNumber, i]));
      const got = plan.assignments.reduce((total, a, row) => {
        const c = a.registrationNumber === null ? undefined : col.get(a.registrationNumber);
        return c === undefined ? total : add(total, costs[row]?.[c] ?? []);
      }, [0, 0, 0, 0, 0, 0]);
      expect(got).toEqual(bruteForce(costs, busCount));
    }
  });
});

describe('the weight bound (S55)', () => {
  it('keeps every matching total exact at 400 duties x 400 buses with the capped base', () => {
    const weights = tierWeights(400, MAX_BASE_COST);
    const top = weights[0] ?? Infinity;
    // A matching's total is under pairs x (the largest cell), and the largest cell is under 2 x top.
    expect(top * 2 * (400 + 1)).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(weights[weights.length - 1]).toBe(1);
  });
});
