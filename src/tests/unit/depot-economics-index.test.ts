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
    lengthCoverage: { n: 4, of: 4 },
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

function fleetInput(id: string, fleet: number, overrides: Partial<EconomicsInput> = {}): EconomicsInput {
  const i = Number(id.slice(1)) % 5;
  return {
    depot: depot(id, 'depot', fleet),
    earningsPerKm: 30 + 2 * i,
    costPerKm: 22 - i,
    loadFactor: 0.4 + 0.05 * i,
    lengthCoverage: { n: 4, of: 4 },
    ...overrides,
  };
}

describe('scoreEconomics, worked figures', () => {
  it('scores the best of five depots 72.5 and ranks it first (hand calculation)', () => {
    // Earnings 30..38 (median 34, MAD 2), cost 22..18 (median 20, MAD 1), load 0.40..0.60
    // (median 0.50, MAD 0.05). Best depot: 38, 18, 0.60. Each z is 4/(1.4826*2) = 1.349,
    // the weights sum to 1, so the weighted z is 1.349 and the index is 50 + 1.349/3*50 = 72.5.
    const five = Array.from({ length: 5 }, (_, i) => fleetInput(`d${i}`, 50));
    const best = scoreEconomics(five).find((s) => s.depotId === 'd4');
    expect(best?.economicsIndex).toBe(72.5);
    expect(best?.rank).toBe(1);
    expect(best?.peerCount).toBe(5);
    expect(scoreEconomics(five).find((s) => s.depotId === 'd0')?.economicsIndex).toBe(27.5);
  });

  it('offers no peer median when too few depots remain to be peers', () => {
    const four = Array.from({ length: 4 }, (_, i) => fleetInput(`d${i}`, 50));
    const [first] = scoreEconomics(four);
    expect(first?.reason).toBe('peer_group_too_small');
    expect(first?.components.map((c) => c.peerMedian)).toEqual([null, null, null]);
  });

  it('merges into one group when a tercile of the complete depots is thin, as the efficiency index does', () => {
    const small = Array.from({ length: 5 }, (_, i) => fleetInput(`d${i}`, 20));
    const medium = Array.from({ length: 5 }, (_, i) =>
      fleetInput(`d${5 + i}`, 50, i < 2 ? { loadFactor: null } : {}),
    );
    const large = Array.from({ length: 5 }, (_, i) => fleetInput(`d${10 + i}`, 90));
    const scores = scoreEconomics([...small, ...medium, ...large]);
    const byId = new Map(scores.map((s) => [s.depotId, s] as const));
    // Medium keeps three complete depots, under the minimum of five, so all thirteen
    // complete depots are ranked together rather than three of them left out.
    expect(scores.filter((s) => s.peerGroup === 'all' && s.ranked)).toHaveLength(13);
    expect(byId.get('d7')?.reason).toBe('ok');
    expect(byId.get('d7')?.peerCount).toBe(13);
    expect(byId.get('d5')?.reason).toBe('missing_component');
    expect(byId.get('d5')?.peerGroup).toBe('all');
  });

  it('groups only the complete depots: a tercile thinned by missing components is never left unranked', () => {
    // Eighteen depots, the two smallest without earnings.
    const inputs = Array.from({ length: 18 }, (_, i) =>
      fleetInput(`d${i}`, 20 + 5 * i, i < 2 ? { earningsPerKm: null } : {}),
    );
    const scores = scoreEconomics(inputs);
    const complete = scores.filter((s) => s.reason !== 'missing_component');
    expect(complete).toHaveLength(16);
    expect(complete.every((s) => s.ranked)).toBe(true);
    expect(scores.filter((s) => s.reason === 'missing_component').map((s) => s.depotId)).toEqual([
      'd0',
      'd1',
    ]);
  });

  it('keeps fleet-size terciles when every tercile of complete depots is large enough', () => {
    const inputs = Array.from({ length: 15 }, (_, i) => fleetInput(`d${i}`, 20 + 10 * i));
    const scores = scoreEconomics(inputs);
    expect(new Set(scores.map((s) => s.peerGroup))).toEqual(new Set(['small', 'medium', 'large']));
    expect(scores.every((s) => s.ranked && s.peerCount === 5)).toBe(true);
  });
});

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
