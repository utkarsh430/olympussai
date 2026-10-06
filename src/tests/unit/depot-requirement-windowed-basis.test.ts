import { describe, expect, it } from 'vitest';
import type { Yard } from '@/lib/depot/infer/types';
import { scoreDepots } from '@/lib/depot/score/dei';
import { DEFAULT_REQUIREMENT_PARAMS } from '@/lib/depot/sim/config';
import { modelBalances, windowedOnRoadShares } from '@/lib/depot/sim/requirement';
import type { DepotSummary } from '@/lib/depot/types';

/*
 * The pure model: which on-road share each depot's requirement reads.
 * The windowed share where there is one, else the depot's single-snapshot share,
 * else the peer median; and the peer median is of those same shares.
 */

const DATE = '2026-10-06';
const NO_YARDS: ReadonlyMap<string, Yard> = new Map();
const P = DEFAULT_REQUIREMENT_PARAMS;

function depot(id: string, fleet: number, out: number): DepotSummary {
  return {
    id,
    name: `Depot ${id}`,
    kind: 'depot',
    fleet,
    status: { live: 0, stationary: 0, noSignal: 0, underMaintenance: 0, unknown: 0 },
    states: { inService: out, onRoad: 0, standing: fleet - out, dark: 0, offRoad: 0 },
    reporting: fleet,
    positioned: fleet,
    assigned: out,
    powerCut: 0,
    tamperFlagged: 0,
    centroid: null,
  };
}

const DEPOTS = [depot('1', 72, 60), depot('2', 40, 30), depot('3', 40, 25), depot('4', 30, 12)];
const peakOf = (balances: ReturnType<typeof modelBalances>, id: string): number =>
  balances.find((b) => b.depotId === id)?.peakRequirement ?? NaN;

describe('the shares the requirement reads', () => {
  it('with the scores of one snapshot equals the single-snapshot rule exactly', () => {
    const windowed = windowedOnRoadShares(scoreDepots(DEPOTS));
    expect(modelBalances(DEPOTS, NO_YARDS, DATE, P, windowed)).toEqual(
      modelBalances(DEPOTS, NO_YARDS, DATE, P),
    );
  });

  it('reads the windowed share where a depot has one', () => {
    const low = modelBalances(DEPOTS, NO_YARDS, DATE, P, new Map([['1', 0.4]]));
    const high = modelBalances(DEPOTS, NO_YARDS, DATE, P, new Map([['1', 0.9]]));
    expect(peakOf(high, '1')).toBeGreaterThan(peakOf(low, '1'));
  });

  it('falls back to the snapshot share for a depot with no windowed value', () => {
    const plain = modelBalances(DEPOTS, NO_YARDS, DATE, P);
    for (const value of [null, Number.NaN]) {
      const windowed = new Map([['1', value]]);
      expect(peakOf(modelBalances(DEPOTS, NO_YARDS, DATE, P, windowed), '1')).toBe(
        peakOf(plain, '1'),
      );
    }
  });

  it('takes the peer median over the windowed shares', () => {
    // Raising every peer's windowed share lowers depot 1's position against them.
    const peers = new Map([['2', 0.95], ['3', 0.95], ['4', 0.95]]);
    const before = peakOf(modelBalances(DEPOTS, NO_YARDS, DATE, P), '1');
    const after = peakOf(modelBalances(DEPOTS, NO_YARDS, DATE, P, peers), '1');
    expect(after).toBeLessThan(before);
  });

  it('is deterministic and leaves its inputs as they were', () => {
    const windowed = new Map([['1', 0.5], ['2', 0.7]]);
    const copy = new Map(windowed);
    const depots = DEPOTS.map((d) => ({ ...d }));
    const a = modelBalances(depots, NO_YARDS, DATE, P, windowed);
    expect(modelBalances([...depots].reverse(), NO_YARDS, DATE, P, windowed)).toEqual(a);
    expect(windowed).toEqual(copy);
    expect(depots).toEqual(DEPOTS);
  });
});
