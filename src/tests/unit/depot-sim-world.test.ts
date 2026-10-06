import { describe, expect, it } from 'vitest';
import { SeededRandom } from '@/lib/simulation/seededRandom';
import type { Yard } from '@/lib/depot/infer/types';
import { DEFAULT_SPARE_RATIO } from '@/lib/depot/optimise/config';
import { DEFAULT_REQUIREMENT_PARAMS } from '@/lib/depot/sim/config';
import { modelDepotMaster } from '@/lib/depot/sim/depotMaster';
import { modelBus } from '@/lib/depot/sim/fleetMaster';
import { modelBalances, spareTargetFor } from '@/lib/depot/sim/requirement';
import type { DepotKind, DepotSummary } from '@/lib/depot/types';
import type { DepotBalance } from '@/lib/depot/optimise/types';

const DATE = '2026-10-06';
const NO_YARDS: ReadonlyMap<string, Yard> = new Map();

function depot(
  id: string,
  fleet: number,
  offRoad: number,
  onRoad = 0,
  kind: DepotKind = 'depot',
  centroid: DepotSummary['centroid'] = null,
): DepotSummary {
  const live = Math.max(0, fleet - offRoad);
  const moving = Math.min(onRoad, live);
  return {
    id,
    name: `Depot ${id}`,
    kind,
    fleet,
    status: { live: 0, stationary: 0, noSignal: 0, underMaintenance: offRoad, unknown: 0 },
    states: { inService: moving, onRoad: 0, standing: live - moving, dark: 0, offRoad },
    reporting: live,
    positioned: live,
    assigned: moving,
    powerCut: 0,
    tamperFlagged: 0,
    centroid,
  };
}

function network(count: number, seed: string): DepotSummary[] {
  const rng = new SeededRandom(seed);
  return Array.from({ length: count }, (_, i) => {
    const fleet = rng.int(0, 200);
    const offRoad = rng.int(0, fleet);
    const kind = rng.pick<DepotKind>(['depot', 'depot', 'depot', 'depot', 'hired', 'electric']);
    return depot(String(i + 1), fleet, offRoad, rng.int(0, fleet), kind);
  });
}

function assertSane(balance: DepotBalance): void {
  const counts = [
    balance.fleet,
    balance.offRoad,
    balance.available,
    balance.peakRequirement,
    balance.spareTarget,
    balance.required,
  ];
  for (const n of counts) {
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(0);
  }
  expect(Number.isInteger(balance.balance)).toBe(true);
  expect(balance.available).toBe(balance.fleet - balance.offRoad);
  expect(balance.required).toBe(balance.peakRequirement + balance.spareTarget);
  expect(balance.balance).toBe(balance.available - balance.required);
  if (balance.kind !== 'depot') expect(balance.balance).toBe(0);
  if (balance.available === 0) expect(balance.required).toBe(0);
}

const HAND_BUILT = [
  depot('1', 100, 10, 60),
  depot('2', 100, 10, 85),
  depot('3', 0, 0),
  depot('4', 40, 40),
  depot('5', 9, 1, 5),
  depot('6', 50, 5, 30, 'hired'),
  depot('7', 30, 0, 10, 'electric'),
  depot('unassigned', 20, 2, 5, 'unassigned'),
];

describe('modelBalances anchoring invariants', () => {
  it('holds on hand-built depots', () => {
    const out = modelBalances(HAND_BUILT, NO_YARDS, DATE, DEFAULT_REQUIREMENT_PARAMS);
    expect(out).toHaveLength(HAND_BUILT.length);
    out.forEach(assertSane);
  });

  it('holds on a synthetic network of 150 depots and stays within 20% of available', () => {
    const depots = network(150, 'world-150');
    expect(depots).toHaveLength(150);
    const out = modelBalances(depots, NO_YARDS, DATE, DEFAULT_REQUIREMENT_PARAMS);
    out.forEach(assertSane);
    const required = out.reduce((s, b) => s + b.required, 0);
    const available = out.reduce((s, b) => s + b.available, 0);
    expect(Math.abs(required - available)).toBeLessThanOrEqual(0.2 * available);
  });

  it('gives a depot with zero available buses zero requirement', () => {
    const [d3, d4] = modelBalances(
      [depot('3', 0, 0), depot('4', 40, 40)],
      NO_YARDS,
      DATE,
      DEFAULT_REQUIREMENT_PARAMS,
    );
    for (const b of [d3, d4]) {
      expect(b?.available).toBe(0);
      expect(b?.required).toBe(0);
      expect(b?.balance).toBe(0);
    }
  });

  it('balances non-depot kinds to zero with required equal to available', () => {
    const out = modelBalances(HAND_BUILT, NO_YARDS, DATE, DEFAULT_REQUIREMENT_PARAMS);
    for (const b of out.filter((x) => x.kind !== 'depot')) {
      expect(b.required).toBe(b.available);
      expect(b.balance).toBe(0);
      expect(b.spareTarget).toBe(0);
    }
  });

  it('is deterministic, and a different operating date changes some requirement', () => {
    const depots = network(150, 'world-det');
    const a = modelBalances(depots, NO_YARDS, DATE, DEFAULT_REQUIREMENT_PARAMS);
    expect(modelBalances(depots, NO_YARDS, DATE, DEFAULT_REQUIREMENT_PARAMS)).toEqual(a);
    const b = modelBalances(depots, NO_YARDS, '2026-10-07', DEFAULT_REQUIREMENT_PARAMS);
    expect(b.some((x, i) => x.required !== a[i]?.required)).toBe(true);
  });

  it('never mutates inputs and sorts numeric ids before unassigned', () => {
    const input = [depot('unassigned', 5, 0, 0, 'unassigned'), depot('10', 50, 0), depot('9', 50, 0)];
    const snapshot = JSON.stringify(input);
    const out = modelBalances(input, NO_YARDS, DATE, DEFAULT_REQUIREMENT_PARAMS);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(out.map((b) => b.depotId)).toEqual(['9', '10', 'unassigned']);
  });

  it('takes position from the yard, else the centroid, else null', () => {
    const yard: Yard = { lat: 1, lng: 2, radiusM: 100, parked: 10, inCluster: 9 };
    const depots = [
      depot('1', 50, 0, 0, 'depot', { lat: 5, lng: 6 }),
      depot('2', 50, 0, 0, 'depot', { lat: 7, lng: 8 }),
      depot('3', 50, 0),
    ];
    const out = modelBalances(depots, new Map([['1', yard]]), DATE, DEFAULT_REQUIREMENT_PARAMS);
    expect(out.map((b) => b.position)).toEqual([{ lat: 1, lng: 2 }, { lat: 7, lng: 8 }, null]);
  });

  it('treats a stretched depot as needing more than a slack peer', () => {
    const params = { ...DEFAULT_REQUIREMENT_PARAMS, noise: 0 };
    const peers = [depot('1', 100, 0, 50), depot('2', 100, 0, 50), depot('3', 100, 0, 50)];
    const out = modelBalances(
      [...peers, depot('4', 100, 0, 95), depot('5', 100, 0, 10)],
      NO_YARDS,
      DATE,
      params,
    );
    const byId = new Map(out.map((b) => [b.depotId, b] as const));
    expect(byId.get('4')!.peakRequirement).toBeGreaterThan(byId.get('5')!.peakRequirement);
  });
});

describe('parameters', () => {
  it('uses the optimiser default spare ratio', () => {
    expect(DEFAULT_REQUIREMENT_PARAMS.spareRatio).toBe(DEFAULT_SPARE_RATIO);
  });

  it('computes the spare target exactly: ratio 0.07 on a peak of 100 is 7', () => {
    expect(spareTargetFor(100, 0.07)).toBe(7);
    expect(spareTargetFor(0, 0.08)).toBe(0);
    expect(spareTargetFor(11, 0.08)).toBe(1);
  });

  it('clamps out-of-range parameters and replaces non-finite ones', () => {
    const one = [depot('1', 100, 0, 50)];
    const at = (spareRatio: number, noise = 0) =>
      modelBalances(one, NO_YARDS, DATE, { ...DEFAULT_REQUIREMENT_PARAMS, spareRatio, noise })[0];
    expect(at(5)).toEqual(at(0.3));
    expect(at(-1)).toEqual(at(0));
    const nan = at(Number.NaN);
    expect(nan).toEqual(at(DEFAULT_REQUIREMENT_PARAMS.spareRatio));
    expect(at(0, 9)).toEqual(at(0, 0.2));
    for (const b of [at(5), nan, at(Infinity, -Infinity)]) assertSane(b as DepotBalance);
  });
});

describe('modelDepotMaster', () => {
  it('never parks fewer than the fleet and is stable by depot, not date', () => {
    for (const d of network(150, 'master')) {
      const m = modelDepotMaster(d, DATE);
      expect(m.parkingCapacity).toBeGreaterThanOrEqual(d.fleet);
      expect(m.parkingCapacity).toBeLessThanOrEqual(Math.ceil(d.fleet * 1.25));
      expect(m.workshopBays).toBe(Math.max(1, Math.round(d.fleet / 25)));
      expect(m.fuelPoints).toBe(Math.max(1, Math.round(d.fleet / 60)));
      expect(modelDepotMaster(d, '2027-01-01')).toEqual(m);
    }
  });
});

describe('modelBus', () => {
  it('is stable per registration', () => {
    expect(modelBus('KA01F1234', null)).toEqual(modelBus('KA01F1234', null));
  });

  it('reads the service class from whole route tokens, case-insensitively', () => {
    expect(modelBus('A', 'BLR_ORD_12').serviceClass).toBe('ordinary');
    expect(modelBus('A', 'blr_exp_12').serviceClass).toBe('express');
    expect(modelBus('A', 'BLR_AC_1').serviceClass).toBe('ac');
    for (const t of ['VOLVO', 'JAN', 'SCANIA']) {
      expect(modelBus('A', `X_${t}`).serviceClass).toBe('premium');
    }
    // Not a whole token, so it must not match.
    const ordinary = modelBus('Z9', 'EXPRESSWAY_BACK');
    expect(ordinary.serviceClass).toBe(modelBus('Z9', null).serviceClass);
  });

  it('gives integer age 0-15, class-dependent seats, and roughly the fixed mix', () => {
    const seats = { ordinary: 52, express: 44, ac: 40, premium: 45 };
    const counts = { ordinary: 0, express: 0, ac: 0, premium: 0 };
    const total = 4000;
    for (let i = 0; i < total; i += 1) {
      const bus = modelBus(`REG${i}`, null);
      expect(Number.isInteger(bus.ageYears)).toBe(true);
      expect(bus.ageYears).toBeGreaterThanOrEqual(0);
      expect(bus.ageYears).toBeLessThanOrEqual(15);
      expect(bus.seats).toBe(seats[bus.serviceClass]);
      counts[bus.serviceClass] += 1;
    }
    expect(counts.ordinary / total).toBeGreaterThan(0.67);
    expect(counts.ordinary / total).toBeLessThan(0.77);
    expect(counts.premium / total).toBeLessThan(0.08);
  });
});
