import { describe, expect, it } from 'vitest';
import { hungarian } from '@/lib/depot/optimise/hungarian';
import { SeededRandom } from '@/lib/simulation/seededRandom';

type Matrix = readonly (readonly number[])[];

/** Best (assigned count, then cost) over every partial assignment of rows to columns. */
function brute(cost: Matrix): { count: number; total: number } {
  const rows = cost.length;
  const cols = rows === 0 ? 0 : (cost[0]?.length ?? 0);
  let best = { count: -1, total: Infinity };
  const used = new Array<boolean>(cols).fill(false);
  const go = (row: number, count: number, total: number): void => {
    if (row === rows) {
      if (count > best.count || (count === best.count && total < best.total)) {
        best = { count, total };
      }
      return;
    }
    go(row + 1, count, total);
    for (let c = 0; c < cols; c += 1) {
      if (used[c] || !Number.isFinite(cost[row]?.[c])) continue;
      used[c] = true;
      go(row + 1, count + 1, total + (cost[row]?.[c] ?? 0));
      used[c] = false;
    }
  };
  go(0, 0, 0);
  return best;
}

function randomMatrix(rng: SeededRandom, rows: number, cols: number, forbidP: number): number[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => (rng.float(0, 1) < forbidP ? Infinity : rng.int(0, 20))),
  );
}

describe('hungarian', () => {
  it('matches brute force on random matrices up to 6x6 with forbidden cells', () => {
    const rng = new SeededRandom('hungarian-brute');
    for (let trial = 0; trial < 400; trial += 1) {
      const rows = rng.int(1, 6);
      const cols = rng.int(1, 6);
      const cost = randomMatrix(rng, rows, cols, trial % 3 === 0 ? 0 : 0.35);
      const { rowToCol, total } = hungarian(cost);
      const expected = brute(cost);
      const assigned = rowToCol.filter((c) => c >= 0);
      expect(assigned.length).toBe(expected.count);
      expect(total).toBe(expected.total);
      expect(new Set(assigned).size).toBe(assigned.length);
      let sum = 0;
      rowToCol.forEach((c, r) => {
        if (c >= 0) {
          const value = cost[r]?.[c] ?? Infinity;
          expect(Number.isFinite(value)).toBe(true);
          sum += value;
        }
      });
      expect(sum).toBe(total);
    }
  });

  it('handles rectangular matrices both ways', () => {
    const wide = hungarian([[5, 1, 9]]);
    expect(wide.rowToCol).toEqual([1]);
    expect(wide.total).toBe(1);
    const tall = hungarian([[4], [2], [7]]);
    expect(tall.rowToCol).toEqual([-1, 0, -1]);
    expect(tall.total).toBe(2);
  });

  it('leaves a fully forbidden row unassigned and keeps the rest optimal', () => {
    const r = hungarian([
      [Infinity, Infinity],
      [3, 1],
    ]);
    expect(r.rowToCol).toEqual([-1, 1]);
    expect(r.total).toBe(1);
  });

  it('prefers more assignments over a cheaper smaller one', () => {
    const r = hungarian([
      [1, Infinity],
      [1, 50],
    ]);
    expect(r.rowToCol).toEqual([0, 1]);
    expect(r.total).toBe(51);
  });

  it('returns empty results for empty matrices', () => {
    expect(hungarian([])).toEqual({ rowToCol: [], total: 0 });
    expect(hungarian([[], []])).toEqual({ rowToCol: [-1, -1], total: 0 });
  });

  it('throws RangeError on negative, NaN or ragged input', () => {
    expect(() => hungarian([[1, -1]])).toThrow(RangeError);
    expect(() => hungarian([[Number.NaN]])).toThrow(RangeError);
    expect(() => hungarian([[-Infinity]])).toThrow(RangeError);
    expect(() => hungarian([[1, 2], [3]])).toThrow(RangeError);
  });

  it('is deterministic on equal costs and does not mutate its input', () => {
    const flat = Object.freeze(
      Array.from({ length: 6 }, () => Object.freeze(new Array<number>(6).fill(3))),
    );
    const a = hungarian(flat);
    expect(hungarian(flat)).toEqual(a);
    expect(a.total).toBe(18);
    expect(new Set(a.rowToCol).size).toBe(6);
  });

  it('solves 150x150 well under a second', () => {
    const rng = new SeededRandom('hungarian-big');
    const cost = randomMatrix(rng, 150, 150, 0.1);
    const started = performance.now();
    const { rowToCol } = hungarian(cost);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(rowToCol.filter((c) => c >= 0).length).toBeGreaterThan(140);
  });
});
