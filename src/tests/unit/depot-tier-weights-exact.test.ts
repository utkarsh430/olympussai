import { describe, expect, it } from 'vitest';
import { MAX_BASE_COST, tierWeights } from '@/lib/depot/optimise/assignDuties';
import { hungarian } from '@/lib/depot/optimise/hungarian';
import { SeededRandom } from '@/lib/simulation/seededRandom';

/*
 * Review m-b: the weight bound is checked from the weights themselves, not by
 * re-stating the guard, and the matcher (the weights and the Hungarian) is
 * compared with an exact BigInt lexicographic optimum at 400 x 400. The test
 * fails if any tier weight changes so that exactness or the tier order is lost.
 */

const PAIRS = 400;
// BigInt(), not literals: the compile target is below ES2020.
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
/** The most each tier can add per pair: four 0/1 tiers, then the capped base. */
const TIER_MAX: readonly bigint[] = [ONE, ONE, ONE, ONE, BigInt(MAX_BASE_COST)];
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

describe('the tier weights at 400 x 400 (S55, m-b)', () => {
  const weights = tierWeights(PAIRS, MAX_BASE_COST).map((w) => BigInt(w));

  it('has one weight per tier, the base last at 1', () => {
    expect(weights).toHaveLength(TIER_MAX.length);
    expect(weights[weights.length - 1]).toBe(ONE);
  });

  it('gives each tier more weight than every lower tier can add over a whole matching', () => {
    for (let k = 0; k < weights.length - 1; k += 1) {
      let lower = ZERO;
      for (let j = k + 1; j < weights.length; j += 1) {
        lower += (weights[j] as bigint) * (TIER_MAX[j] as bigint);
      }
      expect(weights[k] as bigint).toBeGreaterThan(BigInt(PAIRS) * lower);
    }
  });

  it('keeps every cell, total and reduced cost an exact integer', () => {
    const cell = weights.reduce((sum, w, i) => sum + w * (TIER_MAX[i] as bigint), ZERO);
    // Potentials and reduced costs stay within twice the largest cell, over at most P + 1 steps.
    expect(TWO * cell * BigInt(PAIRS + 1)).toBeLessThan(MAX_SAFE);
  });
});

type Tiers = readonly number[];

/**
 * The chance a cell is free (0) on each 0/1 tier, highest first. Free cells are
 * scarce on the high tiers, so no matching is free on all of them and the
 * optimum must trade a unit of one tier against several of the next: exactly
 * where weights that are not lexicographic go wrong.
 */
const FREE_CHANCE: readonly number[] = [0.003, 0.01, 0.03, 0.1];

/** Random tier vectors, the base mostly at its cap: the cases a weak weight would trade badly. */
function adversarial(seed: string, rows: number, cols: number): Tiers[][] {
  const rng = new SeededRandom(seed);
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => [
      ...FREE_CHANCE.map((chance) => (rng.bool(chance) ? 0 : 1)),
      rng.bool(0.7) ? MAX_BASE_COST - rng.int(0, 3) : rng.int(0, MAX_BASE_COST),
    ]),
  );
}

/** An exact minimum-cost assignment in BigInt (rows <= cols): the column of each row. */
function exactAssignment(cost: readonly (readonly bigint[])[]): number[] {
  const n = cost.length;
  const m = cost[0]?.length ?? 0;
  const u = new Array<bigint>(n + 1).fill(ZERO);
  const v = new Array<bigint>(m + 1).fill(ZERO);
  const p = new Array<number>(m + 1).fill(0);
  const way = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i += 1) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<bigint | null>(m + 1).fill(null);
    const used = new Array<boolean>(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0] as number;
      const row = cost[i0 - 1] as readonly bigint[];
      let delta: bigint | null = null;
      let j1 = 0;
      for (let j = 1; j <= m; j += 1) {
        if (used[j]) continue;
        const cur = (row[j - 1] as bigint) - (u[i0] as bigint) - (v[j] as bigint);
        const held = minv[j] ?? null;
        if (held === null || cur < held) {
          minv[j] = cur;
          way[j] = j0;
        }
        const now = minv[j] as bigint;
        if (delta === null || now < delta) {
          delta = now;
          j1 = j;
        }
      }
      const step = delta as bigint;
      for (let j = 0; j <= m; j += 1) {
        if (used[j]) {
          const r = p[j] as number;
          u[r] = (u[r] as bigint) + step;
          v[j] = (v[j] as bigint) - step;
        } else minv[j] = (minv[j] as bigint) - step;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0] as number;
      p[j0] = p[j1] as number;
      j0 = j1;
    } while (j0 !== 0);
  }
  const rowToCol = new Array<number>(n).fill(-1);
  for (let j = 1; j <= m; j += 1) {
    const r = p[j] as number;
    if (r > 0) rowToCol[r - 1] = j - 1;
  }
  return rowToCol;
}

/** Strictly lexicographic weights built by the test itself, in BigInt. */
function referenceWeights(pairs: number): bigint[] {
  const out: bigint[] = [ONE];
  let reach = BigInt(pairs) * (TIER_MAX[TIER_MAX.length - 1] as bigint);
  for (let k = TIER_MAX.length - 2; k >= 0; k -= 1) {
    const w = reach + ONE;
    out.unshift(w);
    reach += BigInt(pairs) * w * (TIER_MAX[k] as bigint);
  }
  return out;
}

function tierTotals(tiers: readonly Tiers[][], rowToCol: readonly number[]): number[] {
  const totals = new Array<number>(TIER_MAX.length).fill(0);
  rowToCol.forEach((c, r) => {
    if (c < 0) return;
    (tiers[r]?.[c] ?? []).forEach((t, i) => {
      totals[i] = (totals[i] as number) + t;
    });
  });
  return totals;
}

const CASES: readonly (readonly [string, number, number])[] = [
  ['adv-1', PAIRS, PAIRS],
  ['adv-2', PAIRS, PAIRS],
  ['adv-3', 300, PAIRS],
];

describe('the matcher against an exact BigInt optimum (S55, m-b)', () => {
  for (const [seed, rows, cols] of CASES) {
    it(`finds the lexicographic optimum on ${rows} x ${cols} (${seed})`, () => {
      const tiers = adversarial(seed, rows, cols);
      const pairs = Math.min(rows, cols);
      const weights = tierWeights(pairs, MAX_BASE_COST);
      const cost = tiers.map((row) =>
        row.map((t) => t.reduce((sum, value, i) => sum + value * (weights[i] as number), 0)),
      );
      const ref = referenceWeights(pairs);
      const exact = tiers.map((row) =>
        row.map((t) => t.reduce((sum, value, i) => sum + BigInt(value) * (ref[i] as bigint), ZERO)),
      );
      const matched = hungarian(cost).rowToCol;
      expect(matched.every((c) => c >= 0)).toBe(true);
      expect(tierTotals(tiers, matched)).toEqual(tierTotals(tiers, exactAssignment(exact)));
    }, 60_000);
  }
});
