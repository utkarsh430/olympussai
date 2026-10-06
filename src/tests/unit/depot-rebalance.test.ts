import { describe, it, expect } from 'vitest';
import {
  applyTransfers,
  planTransfers,
  roadDistanceKm,
  summariseBalances,
} from '@/lib/depot/optimise/rebalance';
import { DEFAULT_REBALANCE_PARAMS } from '@/lib/depot/optimise/config';
import type { DepotBalance, RebalanceParams } from '@/lib/depot/optimise/types';
import type { LatLng } from '@/lib/depot/types';

const PARAMS: RebalanceParams = { ...DEFAULT_REBALANCE_PARAMS, detourFactor: 1 };

/** Positions along one meridian; 0.1 degree of latitude is about 11.1 km. */
function at(tenthsOfDegree: number): LatLng {
  return { lat: tenthsOfDegree / 10, lng: 80 };
}

function depot(
  depotId: string,
  balance: number,
  position: LatLng | null,
  kind: DepotBalance['kind'] = 'depot',
): DepotBalance {
  const required = 100;
  const available = required + balance;
  return {
    depotId,
    depotName: depotId.toUpperCase(),
    kind,
    fleet: available + 5,
    offRoad: 5,
    available,
    peakRequirement: 92,
    spareTarget: 8,
    required,
    balance,
    position,
  };
}

function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], seed: number): T[] {
  const rand = lcg(seed);
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

describe('roadDistanceKm', () => {
  it('scales the great-circle distance by the detour factor', () => {
    const straight = roadDistanceKm(at(0), at(10), 1);
    expect(straight).toBeCloseTo(111.19, 1);
    expect(roadDistanceKm(at(0), at(10), 1.3)).toBeCloseTo(straight * 1.3, 6);
    expect(roadDistanceKm(at(3), at(3), 1.3)).toBe(0);
  });
});

describe('planTransfers', () => {
  it('chooses the cheapest overall plan, not nearest-first', () => {
    // Surplus s1@0, s2@3; deficit d1@2, d2@5 (tenths of a degree). Nearest-first
    // sends s2>d1 (0.1) then s1>d2 (0.5) = 0.6 degrees; the optimum is s1>d1 + s2>d2 = 0.4.
    const plan = planTransfers(
      [
        depot('s1', 1, at(0)),
        depot('s2', 1, at(3)),
        depot('d1', -1, at(2)),
        depot('d2', -1, at(5)),
      ],
      PARAMS,
    );
    expect(plan.transfers.map((t) => t.id).sort()).toEqual(['s1>d1', 's2>d2']);
    const expected = 2 * roadDistanceKm(at(0), at(2), 1);
    expect(plan.totalBusKm).toBeCloseTo(expected, 2);
    const nearestFirst = roadDistanceKm(at(3), at(2), 1) + roadDistanceKm(at(0), at(5), 1);
    expect(plan.totalBusKm).toBeLessThan(nearestFirst);
  });

  it('covers a deficit from several surpluses, nearest capacity first', () => {
    const plan = planTransfers(
      [depot('far', 4, at(8)), depot('near', 3, at(1)), depot('need', -5, at(0))],
      PARAMS,
    );
    expect(plan.coveredDeficit).toBe(5);
    const byFrom = Object.fromEntries(plan.transfers.map((t) => [t.fromDepotId, t.buses]));
    expect(byFrom).toEqual({ near: 3, far: 2 });
    expect(plan.transfers[0]?.id).toBe('near>need');
    expect(plan.uncovered).toEqual([]);
  });

  it('reports what it cannot cover when surplus is short', () => {
    const plan = planTransfers(
      [depot('s', 3, at(0)), depot('d1', -4, at(1)), depot('d2', -2, at(2))],
      PARAMS,
    );
    expect(plan.coveredDeficit).toBe(3);
    expect(plan.before.totalDeficit).toBe(6);
    expect(plan.after.totalDeficit).toBe(3);
    const missing = plan.uncovered.reduce((sum, u) => sum + u.buses, 0);
    expect(missing).toBe(3);
    expect(plan.uncovered.every((u) => u.reason === 'insufficient_surplus')).toBe(true);
  });

  it('reports a deficit beyond reach of every surplus as no_surplus_in_range', () => {
    // 5 degrees is about 556 km, beyond the 250 km default.
    const plan = planTransfers([depot('s', 5, at(0)), depot('d', -3, at(50))], PARAMS);
    expect(plan.transfers).toEqual([]);
    expect(plan.uncovered).toEqual([{ depotId: 'd', buses: 3, reason: 'no_surplus_in_range' }]);
  });

  it('gives a partly reachable deficit the right reason for its remainder', () => {
    const plan = planTransfers([depot('s', 1, at(0)), depot('d', -3, at(10))], PARAMS);
    expect(plan.coveredDeficit).toBe(1);
    expect(plan.uncovered).toEqual([{ depotId: 'd', buses: 2, reason: 'insufficient_surplus' }]);
  });

  it('never takes buses from a locked depot but lets it receive', () => {
    const plan = planTransfers(
      [depot('locked', 5, at(0)), depot('free', 2, at(5)), depot('need', -4, at(1))],
      { ...PARAMS, lockedDepotIds: ['locked'] },
    );
    expect(plan.transfers.every((t) => t.fromDepotId !== 'locked')).toBe(true);
    expect(plan.coveredDeficit).toBe(2);

    const receiving = planTransfers([depot('locked', -2, at(0)), depot('free', 3, at(1))], {
      ...PARAMS,
      lockedDepotIds: ['locked'],
    });
    expect(receiving.transfers).toHaveLength(1);
    expect(receiving.transfers[0]?.toDepotId).toBe('locked');
  });

  it('keeps excluded depots in the totals and reports their deficit as excluded', () => {
    const balances = [
      depot('skip', 9, at(0)),
      depot('skipNeed', -9, at(1)),
      depot('s', 1, at(2)),
      depot('d', -1, at(3)),
    ];
    const plan = planTransfers(balances, { ...PARAMS, excludedDepotIds: ['skip', 'skipNeed'] });
    expect(plan.transfers.map((t) => t.id)).toEqual(['s>d']);
    expect(plan.before).toEqual({
      depotsInDeficit: 2,
      depotsInSurplus: 2,
      totalDeficit: 10,
      totalSurplus: 10,
    });
    expect(plan.after.totalSurplus).toBe(9);
    expect(plan.after.totalDeficit).toBe(9);
    expect(plan.uncovered).toEqual([{ depotId: 'skipNeed', buses: 9, reason: 'excluded' }]);
    expect(plan.coveredDeficit + 9).toBe(plan.before.totalDeficit);
    expect(summariseBalances(applyTransfers(balances, plan.transfers))).toEqual(plan.after);
  });

  it('never plans buses to or from non-depot rows and does not count them', () => {
    const balances = [
      depot('hired', 50, at(0), 'hired'),
      depot('squad', -40, at(1), 'enforcement'),
      depot('ev', -7, at(1), 'electric'),
      depot('d', -3, at(2)),
    ];
    const plan = planTransfers(balances, PARAMS);
    expect(plan.transfers).toEqual([]);
    expect(plan.uncovered).toEqual([{ depotId: 'd', buses: 3, reason: 'no_surplus_in_range' }]);
    expect(plan.before).toEqual({
      depotsInDeficit: 1,
      depotsInSurplus: 0,
      totalDeficit: 3,
      totalSurplus: 0,
    });
    expect(plan.after).toEqual(plan.before);
    const applied = applyTransfers(balances, plan.transfers);
    expect(applied).toEqual(balances);
    expect(summariseBalances(applied)).toEqual(plan.after);
  });

  it('applyTransfers leaves non-depot rows untouched', () => {
    const rows = [depot('hired', 5, at(0), 'hired'), depot('d', -1, at(1))];
    const out = applyTransfers(rows, [
      { id: 'hired>d', fromDepotId: 'hired', toDepotId: 'd', buses: 1, distanceKm: 1, busKm: 1 },
    ]);
    expect(out[0]).toEqual(rows[0]);
  });

  it('gives each uncovered deficit one entry with the highest-precedence reason', () => {
    // Precedence: excluded, then no_position, then no_surplus_in_range, then insufficient_surplus.
    const balances = [
      depot('s', 2, at(0)),
      depot('ex', -1, null), // excluded and positionless: excluded wins
      depot('lost', -2, null), // no_position
      depot('far', -4, at(500)), // out of range of every surplus
      depot('short', -5, at(1)), // reachable but surplus runs out
    ];
    const plan = planTransfers(balances, { ...PARAMS, excludedDepotIds: ['ex'] });
    expect(plan.transfers).toEqual([
      expect.objectContaining({ fromDepotId: 's', toDepotId: 'short', buses: 2 }),
    ]);
    expect(plan.uncovered).toEqual([
      { depotId: 'ex', buses: 1, reason: 'excluded' },
      { depotId: 'far', buses: 4, reason: 'no_surplus_in_range' },
      { depotId: 'lost', buses: 2, reason: 'no_position' },
      { depotId: 'short', buses: 3, reason: 'insufficient_surplus' },
    ]);
  });

  it('reports depots without a position as no_position and never routes through them', () => {
    const plan = planTransfers(
      [
        depot('s', 5, at(0)),
        depot('lost', -2, null),
        depot('lostSurplus', 4, null),
        depot('d', -1, at(1)),
      ],
      PARAMS,
    );
    expect(plan.transfers.map((t) => t.id)).toEqual(['s>d']);
    expect(plan.uncovered).toEqual([{ depotId: 'lost', buses: 2, reason: 'no_position' }]);
  });

  it('applyTransfers reproduces plan.after, and covered + uncovered = total deficit', () => {
    const rand = lcg(5);
    for (let trial = 0; trial < 25; trial++) {
      const balances = Array.from({ length: 14 }, (_, i) =>
        depot(
          `d${i}`,
          Math.floor(rand() * 13) - 6,
          rand() < 0.1 ? null : at(Math.floor(rand() * 40)),
          rand() < 0.15 ? 'hired' : 'depot',
        ),
      );
      const pick = (): string[] => balances.filter(() => rand() < 0.2).map((b) => b.depotId);
      const plan = planTransfers(balances, {
        ...PARAMS,
        lockedDepotIds: pick(),
        excludedDepotIds: pick(),
      });
      expect(summariseBalances(applyTransfers(balances, plan.transfers))).toEqual(plan.after);
      const uncovered = plan.uncovered.reduce((sum, u) => sum + u.buses, 0);
      expect(plan.coveredDeficit + uncovered).toBe(plan.before.totalDeficit);
      expect(plan.before.totalDeficit - plan.after.totalDeficit).toBe(plan.coveredDeficit);
      for (const t of plan.transfers) {
        expect(Number.isInteger(t.buses)).toBe(true);
        expect(t.buses).toBeGreaterThan(0);
        expect(t.busKm).toBeCloseTo(t.buses * t.distanceKm, 6);
        expect(t.distanceKm).toBeLessThanOrEqual(PARAMS.maxTransferKm);
      }
    }
  });

  it('applyTransfers moves fleet and availability and recomputes the balance', () => {
    const before = [depot('a', 3, at(0)), depot('b', -2, at(1))];
    const after = applyTransfers(before, [
      { id: 'a>b', fromDepotId: 'a', toDepotId: 'b', buses: 2, distanceKm: 10, busKm: 20 },
    ]);
    expect(after[0]).toMatchObject({ fleet: 106, available: 101, balance: 1 });
    expect(after[1]).toMatchObject({ available: 100, balance: 0, fleet: 105 });
  });

  it('returns the same plan for shuffled input, including tied costs', () => {
    const balances = [
      depot('a', 2, at(0)),
      depot('b', 2, at(0)),
      depot('c', -2, at(1)),
      depot('d', -2, at(1)),
      depot('e', 1, at(4)),
      depot('f', -1, at(3)),
    ];
    const reference = planTransfers(balances, PARAMS);
    for (let seed = 1; seed <= 10; seed++) {
      expect(planTransfers(shuffled(balances, seed), PARAMS)).toEqual(reference);
    }
  });

  it('does not mutate its inputs', () => {
    const balances = [depot('s', 2, at(0)), depot('d', -2, at(1))].map((b) => Object.freeze(b));
    const params = Object.freeze({
      ...PARAMS,
      lockedDepotIds: Object.freeze(['x']),
      excludedDepotIds: Object.freeze(['y']),
    });
    const snapshot = JSON.stringify([balances, params]);
    const plan = planTransfers(balances, params);
    applyTransfers(balances, plan.transfers);
    expect(JSON.stringify([balances, params])).toBe(snapshot);
  });

  it('plans a 143-depot network well under a second', () => {
    const rand = lcg(99);
    const balances = Array.from({ length: 143 }, (_, i) =>
      depot(`dep${String(i).padStart(3, '0')}`, Math.floor(rand() * 21) - 10, {
        lat: 24 + rand() * 6,
        lng: 77 + rand() * 6,
      }),
    );
    const start = performance.now();
    const plan = planTransfers(balances, DEFAULT_REBALANCE_PARAMS);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(1000);
    const uncovered = plan.uncovered.reduce((sum, u) => sum + u.buses, 0);
    expect(plan.coveredDeficit + uncovered).toBe(plan.before.totalDeficit);
  });
});
