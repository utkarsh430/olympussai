import { describe, expect, it } from 'vitest';
import { planTransfers } from '@/lib/depot/optimise/rebalance';
import { compareOutcomes, runScenario } from '@/lib/depot/optimise/scenario';
import { DEFAULT_REBALANCE_PARAMS } from '@/lib/depot/optimise/config';
import type { DepotBalance, RebalanceParams } from '@/lib/depot/optimise/types';

/**
 * The transfer table prints each row's distance and bus-km to 0.1 km, and the
 * headline prints the total. Every printed figure must agree with the others:
 * buses times the printed distance is the printed bus-km, and the printed rows
 * add up to the printed total.
 */

const PARAMS: RebalanceParams = { ...DEFAULT_REBALANCE_PARAMS, detourFactor: 1.3 };
const PLANS = 300;

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

function balancesFor(seed: number): DepotBalance[] {
  const rand = lcg(seed);
  return Array.from({ length: 12 }, (_, i) => {
    const balance = Math.floor(rand() * 41) - 20;
    const required = 100;
    const available = required + balance;
    return {
      depotId: `d${i}`,
      depotName: `D${i}`,
      kind: 'depot',
      fleet: available + 5,
      offRoad: 5,
      available,
      peakRequirement: 92,
      spareTarget: 8,
      required,
      balance,
      position: { lat: 26 + rand() * 0.6, lng: 80 + rand() * 0.6 },
    };
  });
}

/** A figure as the table prints it, in whole tenths of a kilometre. */
function tenths(km: number): number {
  return Number(km.toFixed(1).replace('.', ''));
}

describe('rebalance distances and bus-km add up as printed', () => {
  it('prints buses times distance as each row bus-km, and rows that sum to the total', () => {
    const misses: string[] = [];
    for (let seed = 1; seed <= PLANS; seed += 1) {
      const plan = planTransfers(balancesFor(seed), PARAMS);
      for (const t of plan.transfers) {
        if (t.buses * tenths(t.distanceKm) !== tenths(t.busKm)) {
          misses.push(`${seed} ${t.id}: ${t.buses} x ${t.distanceKm} vs ${t.busKm}`);
        }
      }
      const rows = plan.transfers.reduce((sum, t) => sum + tenths(t.busKm), 0);
      if (rows !== tenths(plan.totalBusKm)) misses.push(`${seed} total ${plan.totalBusKm}`);
    }
    expect(misses).toEqual([]);
  });

  it('keeps every distance and bus-km on the 100 m grid, with no float residue', () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const plan = planTransfers(balancesFor(seed), PARAMS);
      for (const value of [plan.totalBusKm, ...plan.transfers.flatMap((t) => [t.distanceKm, t.busKm])]) {
        expect(value).toBe(Math.round(value * 10) / 10);
      }
    }
  });

  it('reports a change in total bus-km to the tenth, with no float residue', () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const base = balancesFor(seed);
      const baseline = runScenario(base, {});
      const candidate = runScenario(base, { demandSurges: [{ depotId: 'd3', percent: 40 }] });
      const delta = compareOutcomes(baseline, candidate).totalBusKm;
      expect(delta).toBe(Math.round(delta * 10) / 10);
      expect(tenths(delta)).toBe(tenths(candidate.plan.totalBusKm) - tenths(baseline.plan.totalBusKm));
    }
  });
});
