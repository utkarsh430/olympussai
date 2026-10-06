import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { scoreEconomics } from '@/lib/depot/revenue/economicsIndex';
import type { EconomicsComponentKey, EconomicsInput } from '@/lib/depot/revenue/types';
import { ECONOMICS_WEIGHTS } from '@/lib/depot/sim/revenueConfig';
import type { DepotKind, DepotSummary } from '@/lib/depot/types';

function depot(id: string, kind: DepotKind = 'depot', fleet = 50): DepotSummary {
  return {
    id,
    name: `Depot ${id}`,
    kind,
    fleet,
    status: { live: 0, stationary: 0, noSignal: 0, underMaintenance: 0, unknown: 0 },
    states: { inService: 0, onRoad: 0, standing: 0, dark: 0, offRoad: 0 },
    reporting: 0,
    positioned: 0,
    assigned: 0,
    powerCut: 0,
    tamperFlagged: 0,
    centroid: null,
  };
}

const COUNT = 9;

function input(i: number, overrides: Partial<EconomicsInput> = {}): EconomicsInput {
  return {
    depot: depot(`${100 + i}`),
    earningsPerKm: 20 + i * 1.5,
    costPerKm: 30 + ((i * 7) % COUNT),
    loadFactor: 0.4 + i * 0.02,
    earningsCoverage: { n: 4, of: 4 },
    ...overrides,
  };
}

const peers: readonly EconomicsInput[] = Array.from({ length: COUNT }, (_, i) => input(i));

function indexOfFirst(inputs: readonly EconomicsInput[]): number | null {
  return scoreEconomics(inputs)[0]?.economicsIndex ?? null;
}

function sweep(key: EconomicsComponentKey, values: readonly number[]): (number | null)[] {
  return values.map((v) => indexOfFirst([{ ...input(0), [key]: v }, ...peers.slice(1)]));
}

function isNonDecreasing(xs: readonly (number | null)[]): boolean {
  return xs.every((x, i) => x !== null && (i === 0 || x >= (xs[i - 1] ?? 0)));
}

describe('scoreEconomics', () => {
  it('has component weights that sum to one', () => {
    const total = Object.values(ECONOMICS_WEIGHTS).reduce((s, w) => s + w, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('rises with earnings per kilometre', () => {
    const xs = sweep('earningsPerKm', [5, 15, 25, 35, 60]);
    expect(isNonDecreasing(xs)).toBe(true);
    expect(xs[xs.length - 1]).toBeGreaterThan(xs[0] ?? Infinity);
  });

  it('rises with load factor', () => {
    const xs = sweep('loadFactor', [0.1, 0.3, 0.5, 0.7, 0.9]);
    expect(isNonDecreasing(xs)).toBe(true);
    expect(xs[xs.length - 1]).toBeGreaterThan(xs[0] ?? Infinity);
  });

  it('falls as cost per kilometre rises', () => {
    const xs = sweep('costPerKm', [10, 25, 35, 50, 90]);
    expect(isNonDecreasing([...xs].reverse())).toBe(true);
    expect(xs[0]).toBeGreaterThan(xs[xs.length - 1] ?? Infinity);
  });

  it('leaves a depot missing a component unranked, with the reason, and ranks the rest', () => {
    const scores = scoreEconomics([input(0, { earningsPerKm: null }), ...peers.slice(1)]);
    const missing = scores[0];
    expect(missing?.ranked).toBe(false);
    expect(missing?.reason).toBe('missing_component');
    expect(missing?.missing).toEqual(['earningsPerKm']);
    expect(missing?.economicsIndex).toBeNull();
    expect(missing?.rank).toBeNull();
    expect(scores[1]?.ranked).toBe(true);
    expect(scores[1]?.peerCount).toBe(COUNT - 1);
  });

  it('treats a non-finite component as missing', () => {
    const [score] = scoreEconomics([input(0, { costPerKm: Number.NaN }), ...peers.slice(1)]);
    expect(score?.ranked).toBe(false);
    expect(score?.missing).toEqual(['costPerKm']);
    expect(JSON.stringify(score)).not.toMatch(/NaN|Infinity/);
  });

  it('does not rank units that are not depots, or fleets too small', () => {
    const scores = scoreEconomics([
      ...peers,
      { ...input(50), depot: depot('hired', 'hired') },
      { ...input(51), depot: depot('tiny', 'depot', 3) },
    ]);
    expect(scores.find((s) => s.depotId === 'hired')?.reason).toBe('not_a_depot');
    expect(scores.find((s) => s.depotId === 'tiny')?.reason).toBe('fleet_too_small');
    expect(scores.find((s) => s.depotId === 'hired')?.peerGroup).toBeNull();
  });

  it('survives a peer group with zero spread', () => {
    const flat = Array.from({ length: COUNT }, (_, i) =>
      input(i, { earningsPerKm: 22, costPerKm: 33, loadFactor: 0.5 }),
    );
    const scores = scoreEconomics(flat);
    for (const score of scores) {
      expect(score.economicsIndex).toBe(50);
      expect(JSON.stringify(score)).not.toMatch(/NaN|Infinity/);
    }
  });

  it('carries value, peer median, contribution and provenance on every component', () => {
    const [score] = scoreEconomics(peers);
    expect(score?.provenance).toBe('modelled');
    expect(score?.components.map((c) => c.key)).toEqual(['earningsPerKm', 'costPerKm', 'loadFactor']);
    for (const c of score?.components ?? []) {
      expect(c.provenance).toBe('modelled');
      expect(c.value).not.toBeNull();
      expect(c.peerMedian).not.toBeNull();
    }
    const weighted = (score?.components ?? []).reduce((s, c) => s + c.contribution, 0);
    expect(score?.economicsIndex).toBeCloseTo(Math.round((50 + (weighted / 3) * 50) * 10) / 10, 5);
  });

  it('ranks within the group from 1, best first', () => {
    const scores = scoreEconomics(peers);
    const ranks = scores.map((s) => s.rank).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(ranks).toEqual(Array.from({ length: COUNT }, (_, i) => i + 1));
    const best = scores.find((s) => s.rank === 1);
    const worst = scores.find((s) => s.rank === COUNT);
    expect(best?.economicsIndex).toBeGreaterThanOrEqual(worst?.economicsIndex ?? 100);
  });

  it('gives the same score per depot for shuffled input, and does not mutate it', () => {
    const frozen = JSON.stringify(peers);
    const forward = scoreEconomics(peers);
    const shuffled = scoreEconomics([...peers].reverse());
    for (const score of forward) {
      expect(shuffled.find((s) => s.depotId === score.depotId)).toEqual(score);
    }
    expect(JSON.stringify(peers)).toBe(frozen);
  });

  it('keeps every score from 0 to 100 even with extreme depots', () => {
    const extreme = [input(0, { earningsPerKm: 1e9, costPerKm: 0.0001 }), ...peers.slice(1)];
    for (const s of scoreEconomics(extreme)) {
      expect(s.economicsIndex).toBeGreaterThanOrEqual(0);
      expect(s.economicsIndex).toBeLessThanOrEqual(100);
    }
  });
});

function importSpecifiers(source: string): string[] {
  const found = source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g);
  return [...found].map((m) => m[1] ?? '');
}

function tsFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? tsFilesUnder(join(dir, entry.name))
      : entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')
        ? [join(dir, entry.name)]
        : [],
  );
}

describe('separation from the Depot Efficiency Index', () => {
  const scoreDir = join(process.cwd(), 'src/lib/depot/score');
  const files = tsFilesUnder(scoreDir);
  const FORBIDDEN = /(^|\/)(revenue|economics|ridership)(\/|$)|economicsIndex|revenueConfig|ridership/;

  it('finds import specifiers in the way it claims to', () => {
    expect(importSpecifiers("import { a } from '../revenue/types';\nimport './x';")).toEqual([
      '../revenue/types',
      './x',
    ]);
  });

  it('imports nothing from the revenue, economics or ridership modules, at any depth of score/', () => {
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      for (const specifier of importSpecifiers(readFileSync(file, 'utf8'))) {
        expect(specifier, file).not.toMatch(FORBIDDEN);
      }
    }
  });

  it('does not reuse the DepotScore type or its shape', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/lib/depot/revenue/economicsIndex.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/\bDepotScore\b/);
    const [score] = scoreEconomics(peers);
    expect(score).not.toHaveProperty('index');
    expect(score).toHaveProperty('economicsIndex');
  });
});
