import { describe, it, expect } from 'vitest';
import { minCostMaxFlow, type FlowEdgeInput } from '@/lib/depot/optimise/minCostFlow';

/** S=0, surplus A=1,B=2, deficit X=3,Y=4, T=5. Nearest-first (A-X, then B-Y) costs 11. */
const TWO_BY_TWO: readonly FlowEdgeInput[] = [
  { from: 0, to: 1, capacity: 1, cost: 0 },
  { from: 0, to: 2, capacity: 1, cost: 0 },
  { from: 1, to: 3, capacity: 1, cost: 1 },
  { from: 1, to: 4, capacity: 1, cost: 3 },
  { from: 2, to: 3, capacity: 1, cost: 3 },
  { from: 2, to: 4, capacity: 1, cost: 10 },
  { from: 3, to: 5, capacity: 1, cost: 0 },
  { from: 4, to: 5, capacity: 1, cost: 0 },
];

function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** Brute-force optimum over assignments of unit supplies to unit demands (n small). */
function bruteForce(cost: readonly (readonly number[])[]): number {
  const n = cost.length;
  const used = new Array<boolean>(n).fill(false);
  const go = (i: number): number => {
    if (i === n) return 0;
    let best = Infinity;
    for (let j = 0; j < n; j++) {
      if (used[j]) continue;
      used[j] = true;
      best = Math.min(best, (cost[i]?.[j] ?? 0) + go(i + 1));
      used[j] = false;
    }
    return best;
  };
  return go(0);
}

describe('minCostMaxFlow', () => {
  it('finds the true optimum where nearest-first is not cheapest', () => {
    const result = minCostMaxFlow(6, TWO_BY_TWO, 0, 5);
    expect(result.flow).toBe(2);
    expect(result.cost).toBe(6);
    expect(result.edgeFlows).toEqual([1, 1, 0, 1, 1, 0, 1, 1]);
  });

  it('matches brute force on random assignment problems', () => {
    const rand = lcg(7);
    for (let trial = 0; trial < 40; trial++) {
      const n = 4;
      const cost = Array.from({ length: n }, () =>
        Array.from({ length: n }, () => Math.floor(rand() * 50)),
      );
      const edges: FlowEdgeInput[] = [];
      for (let i = 0; i < n; i++) edges.push({ from: 0, to: 1 + i, capacity: 1, cost: 0 });
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          edges.push({ from: 1 + i, to: 1 + n + j, capacity: 1, cost: cost[i]?.[j] ?? 0 });
        }
      }
      for (let j = 0; j < n; j++) {
        edges.push({ from: 1 + n + j, to: 1 + 2 * n, capacity: 1, cost: 0 });
      }
      const result = minCostMaxFlow(2 + 2 * n, edges, 0, 1 + 2 * n);
      expect(result.flow).toBe(n);
      expect(result.cost).toBe(bruteForce(cost));
    }
  });

  it('maximises flow first, then minimises cost among maximum flows', () => {
    const edges: FlowEdgeInput[] = [
      { from: 0, to: 1, capacity: 1, cost: 1 },
      { from: 0, to: 2, capacity: 1, cost: 100 },
      { from: 1, to: 3, capacity: 1, cost: 1 },
      { from: 2, to: 3, capacity: 1, cost: 100 },
    ];
    const result = minCostMaxFlow(4, edges, 0, 3);
    expect(result.flow).toBe(2);
    expect(result.cost).toBe(202);
  });

  it('conserves flow at inner nodes, respects capacity and uses integers', () => {
    const rand = lcg(11);
    for (let trial = 0; trial < 20; trial++) {
      const nodes = 8;
      const edges: FlowEdgeInput[] = [];
      for (let k = 0; k < 24; k++) {
        const from = Math.floor(rand() * (nodes - 1));
        const to = 1 + Math.floor(rand() * (nodes - 1));
        if (from === to) continue;
        edges.push({ from, to, capacity: Math.floor(rand() * 5), cost: Math.floor(rand() * 9) });
      }
      const result = minCostMaxFlow(nodes, edges, 0, nodes - 1);
      const net = new Array<number>(nodes).fill(0);
      edges.forEach((e, i) => {
        const f = result.edgeFlows[i] ?? 0;
        expect(Number.isInteger(f)).toBe(true);
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThanOrEqual(e.capacity);
        net[e.from] = (net[e.from] ?? 0) - f;
        net[e.to] = (net[e.to] ?? 0) + f;
      });
      for (let v = 1; v < nodes - 1; v++) expect(net[v]).toBe(0);
      expect(net[nodes - 1]).toBe(result.flow);
      const cost = edges.reduce((sum, e, i) => sum + e.cost * (result.edgeFlows[i] ?? 0), 0);
      expect(result.cost).toBe(cost);
    }
  });

  it('returns zero flow when the sink is unreachable or capacities are zero', () => {
    expect(minCostMaxFlow(3, [{ from: 0, to: 1, capacity: 5, cost: 1 }], 0, 2)).toEqual({
      flow: 0,
      cost: 0,
      edgeFlows: [0],
    });
    const zero = minCostMaxFlow(2, [{ from: 0, to: 1, capacity: 0, cost: 1 }], 0, 1);
    expect(zero.flow).toBe(0);
  });

  it('is deterministic and does not mutate its input', () => {
    const frozen = TWO_BY_TWO.map((e) => Object.freeze({ ...e }));
    const a = minCostMaxFlow(6, frozen, 0, 5);
    const b = minCostMaxFlow(6, frozen, 0, 5);
    expect(a).toEqual(b);
    expect(frozen).toEqual(TWO_BY_TWO);
  });

  it('rejects invalid input', () => {
    expect(() => minCostMaxFlow(2, [{ from: 0, to: 1, capacity: 1.5, cost: 1 }], 0, 1)).toThrow();
    expect(() => minCostMaxFlow(2, [{ from: 0, to: 5, capacity: 1, cost: 1 }], 0, 1)).toThrow();
    expect(() => minCostMaxFlow(2, [{ from: 0, to: 1, capacity: -1, cost: 1 }], 0, 1)).toThrow();
  });
});
