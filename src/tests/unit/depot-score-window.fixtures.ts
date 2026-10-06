import type { DepotSummary } from '@/lib/depot/types';

/** Deterministic generator (mulberry32): the same seed always gives the same sequence. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const T0 = Date.parse('2026-10-06T14:00:00.000Z');

export function feedTime(offsetSeconds: number): string {
  return new Date(T0 + offsetSeconds * 1000).toISOString();
}

export interface Rates {
  readonly onRoad: number;
  readonly dark: number;
  readonly offRoad: number;
  readonly assigned: number;
}

function binomial(n: number, p: number, random: () => number): number {
  let hits = 0;
  for (let i = 0; i < n; i += 1) if (random() < p) hits += 1;
  return hits;
}

/** A depot whose counts are drawn around fixed rates: the noise one snapshot carries. */
export function depotAt(
  id: string,
  fleet: number,
  rates: Rates,
  random: () => number,
): DepotSummary {
  const offRoad = binomial(fleet, rates.offRoad, random);
  const dark = binomial(fleet - offRoad, rates.dark, random);
  const moving = binomial(fleet - offRoad - dark, rates.onRoad, random);
  const inService = Math.floor(moving / 2);
  return {
    id,
    name: `DEPOT ${id}`,
    kind: 'depot',
    fleet,
    status: { live: moving, stationary: 0, noSignal: dark, underMaintenance: offRoad, unknown: 0 },
    states: {
      inService,
      onRoad: moving - inService,
      standing: fleet - offRoad - dark - moving,
      dark,
      offRoad,
    },
    reporting: fleet - dark,
    positioned: fleet,
    assigned: binomial(fleet, rates.assigned, random),
    powerCut: binomial(fleet, 0.05, random),
    tamperFlagged: 0,
    centroid: null,
  };
}

export interface Network {
  readonly fleets: readonly number[];
  readonly rates: readonly Rates[];
}

/** Fixed fleets and fixed underlying rates for `count` depots. */
export function network(count: number, seed: number): Network {
  const random = seeded(seed);
  const fleets: number[] = [];
  const rates: Rates[] = [];
  for (let i = 0; i < count; i += 1) {
    fleets.push(30 + Math.floor(random() * 170));
    rates.push({
      onRoad: 0.3 + random() * 0.4,
      dark: 0.05 + random() * 0.25,
      offRoad: 0.02 + random() * 0.08,
      assigned: 0.2 + random() * 0.6,
    });
  }
  return { fleets, rates };
}

export interface Movement {
  readonly indexMedian: number;
  readonly indexMax: number;
  readonly rankMedian: number;
  readonly rankMax: number;
}

function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** Per-depot range (max minus min) of index and rank over a run of score lists. */
export function movementOf(
  runs: readonly (readonly { depotId: string; index: number | null; rank: number | null }[])[],
): Movement {
  const index = new Map<string, number[]>();
  const rank = new Map<string, number[]>();
  for (const scores of runs) {
    for (const s of scores) {
      if (s.index === null || s.rank === null) continue;
      index.set(s.depotId, [...(index.get(s.depotId) ?? []), s.index]);
      rank.set(s.depotId, [...(rank.get(s.depotId) ?? []), s.rank]);
    }
  }
  const range = (v: readonly number[]): number => Math.max(...v) - Math.min(...v);
  const indexRanges = [...index.values()].map(range);
  const rankRanges = [...rank.values()].map(range);
  const one = (v: number): number => Math.round(v * 10) / 10;
  return {
    indexMedian: one(medianOf(indexRanges)),
    indexMax: one(Math.max(...indexRanges)),
    rankMedian: medianOf(rankRanges),
    rankMax: Math.max(...rankRanges),
  };
}

/** One snapshot of the network: every depot redrawn around its own rates. */
export function snapshotOf(net: Network, random: () => number): DepotSummary[] {
  return net.fleets.map((fleet, i) => depotAt(String(i + 1), fleet, net.rates[i]!, random));
}
