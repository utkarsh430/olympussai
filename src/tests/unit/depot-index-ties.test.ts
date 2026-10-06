import { describe, expect, it } from 'vitest';
import { scoreEconomics } from '@/lib/depot/revenue/economicsIndex';
import type { EconomicsInput } from '@/lib/depot/revenue/types';
import { scoreDepots } from '@/lib/depot/score/dei';
import type { DepotSummary } from '@/lib/depot/types';

/**
 * Both indexes are shown to one decimal. Two depots shown with the same index
 * hold the same rank, and the next depot's rank skips the shared places
 * (1, 2, 2, 4), so a reader is never told one of two equal depots is ahead.
 */

function depot(id: string, onRoad: number, dark: number): DepotSummary {
  return {
    id,
    name: `Depot ${id}`,
    kind: 'depot',
    fleet: 50,
    status: { live: 0, stationary: 0, noSignal: 0, underMaintenance: 0, unknown: 0 },
    states: { inService: onRoad, onRoad: 0, standing: 40 - onRoad, dark, offRoad: 10 - dark },
    reporting: 50 - dark,
    positioned: 50 - dark,
    assigned: 0,
    powerCut: 0,
    tamperFlagged: 0,
    centroid: null,
  };
}

function economicsInput(id: string, earnings: number): EconomicsInput {
  return {
    depot: depot(id, 30, 2),
    earningsPerKm: earnings,
    costPerKm: 20,
    loadFactor: 0.5,
    lengthCoverage: { n: 4, of: 4 },
  };
}

describe('equal indexes share a rank', () => {
  it('ranks two depots with the same efficiency index equally, and the next skips', () => {
    // b and c hold identical counts, so identical indexes.
    const depots = [
      depot('a', 36, 1),
      depot('c', 30, 2),
      depot('b', 30, 2),
      depot('d', 26, 3),
      depot('e', 22, 4),
      depot('f', 18, 5),
    ];
    const byId = new Map(scoreDepots(depots).map((s) => [s.depotId, s] as const));
    expect(byId.get('b')?.index).toBe(byId.get('c')?.index);
    expect(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => byId.get(id)?.rank)).toEqual([
      1, 2, 2, 4, 5, 6,
    ]);
  });

  it('ranks two depots with the same economics index equally, and the next skips', () => {
    const inputs = [
      economicsInput('p', 40),
      economicsInput('r', 34),
      economicsInput('q', 34),
      economicsInput('s', 30),
      economicsInput('t', 28),
    ];
    const byId = new Map(scoreEconomics(inputs).map((s) => [s.depotId, s] as const));
    expect(byId.get('q')?.economicsIndex).toBe(byId.get('r')?.economicsIndex);
    expect(['p', 'q', 'r', 's', 't'].map((id) => byId.get(id)?.rank)).toEqual([1, 2, 2, 4, 5]);
  });

  it('shares a rank among every depot of a group when all are equal', () => {
    const inputs = ['v', 'w', 'x', 'y', 'z'].map((id) => economicsInput(id, 30));
    expect(scoreEconomics(inputs).map((s) => s.rank)).toEqual([1, 1, 1, 1, 1]);
  });
});
