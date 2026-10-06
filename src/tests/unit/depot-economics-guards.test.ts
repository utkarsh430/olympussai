import { describe, it, expect } from 'vitest';
import { SeededRandom } from '@/lib/simulation/seededRandom';
import { analyseRevenue } from '@/lib/depot/revenue/analysis';
import { scoreEconomics } from '@/lib/depot/revenue/economicsIndex';
import type {
  EconomicsComponentKey,
  EconomicsInput,
  RouteRidershipInput,
} from '@/lib/depot/revenue/types';
import { MIN_PEER_GROUP } from '@/lib/depot/score/config';
import { MAX_LOAD_FACTOR } from '@/lib/depot/sim/revenueConfig';
import { modelRidershipDay } from '@/lib/depot/sim/ridership';
import { seedFor } from '@/lib/depot/sim/seed';
import type { ServiceClass } from '@/lib/depot/sim/types';
import type { Coverage, DepotSummary } from '@/lib/depot/types';

const CASES = 150;
const CLASSES: readonly ServiceClass[] = ['ordinary', 'express', 'ac', 'premium'];

function depot(id: string): DepotSummary {
  return {
    id,
    name: `Depot ${id}`,
    kind: 'depot',
    fleet: 50,
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

const GOOD: Coverage = { n: 4, of: 4 };

function input(i: number, over: Partial<EconomicsInput> = {}): EconomicsInput {
  return {
    depot: depot(`${100 + i}`),
    earningsPerKm: 30 + i * 1.5,
    costPerKm: 20 + ((i * 7) % 9),
    loadFactor: 0.4 + i * 0.02,
    lengthCoverage: GOOD,
    ...over,
  };
}

const complete = (n: number): EconomicsInput[] => Array.from({ length: n }, (_, i) => input(i));

function nonFinite(value: unknown): boolean {
  return JSON.stringify(value, (_k, v: unknown) =>
    typeof v === 'number' && !Number.isFinite(v) ? '__NON_FINITE__' : v,
  ).includes('__NON_FINITE__');
}

describe('peer group size guard', () => {
  it.each([1, 4, MIN_PEER_GROUP])('a complete sample of %i', (n) => {
    const scores = scoreEconomics(complete(n));
    const ranked = n >= MIN_PEER_GROUP;
    for (const score of scores) {
      expect(score.peerGroup).toBe('all');
      expect(score.ranked).toBe(ranked);
      expect(score.reason).toBe(ranked ? 'ok' : 'peer_group_too_small');
      expect(score.rank === null).toBe(!ranked);
      expect(score.economicsIndex === null).toBe(!ranked);
    }
  });

  it('counts only depots with every component: a group that shrinks below the minimum is unranked', () => {
    const group = [...complete(MIN_PEER_GROUP - 1), input(MIN_PEER_GROUP - 1, { costPerKm: null })];
    const scores = scoreEconomics(group);
    expect(scores.at(-1)?.reason).toBe('missing_component');
    for (const score of scores.slice(0, -1)) expect(score.reason).toBe('peer_group_too_small');
    const enough = scoreEconomics([...group, input(20)]);
    expect(enough.filter((s) => s.ranked)).toHaveLength(MIN_PEER_GROUP);
  });
});

describe('route coverage guard', () => {
  function reasonFor(coverage: Coverage): { reason: string; ranked: boolean; others: boolean } {
    const scores = scoreEconomics([input(0, { lengthCoverage: coverage }), ...complete(9).slice(1)]);
    const first = scores[0];
    return {
      reason: first?.reason ?? '',
      ranked: first?.ranked ?? false,
      others: scores.slice(1).every((s) => s.ranked),
    };
  }

  it.each([
    [{ n: 1, of: 1 }, 'thin_route_coverage'], // one route is under the count of two
    [{ n: 1, of: 4 }, 'thin_route_coverage'], // exactly a quarter, but under two routes
    [{ n: 2, of: 9 }, 'thin_route_coverage'], // two routes, but 22% is under a quarter
    [{ n: 2, of: 8 }, 'ok'], // exactly two routes and exactly a quarter
    [{ n: 2, of: 2 }, 'ok'],
    [{ n: 3, of: 8 }, 'ok'],
  ])('%j', (coverage, expected) => {
    const result = reasonFor(coverage as Coverage);
    expect(result.reason).toBe(expected);
    expect(result.ranked).toBe(expected === 'ok');
    expect(result.others).toBe(true);
  });

  it('carries the coverage on the earnings component of a ranked depot', () => {
    const score = scoreEconomics([input(0, { lengthCoverage: { n: 3, of: 8 } }), ...complete(9).slice(1)])[0];
    const earnings = score?.components.find((c) => c.key === 'earningsPerKm');
    expect(earnings?.coverage).toEqual({ n: 3, of: 8 });
    expect(score?.components.find((c) => c.key === 'costPerKm')?.coverage).toBeNull();
  });

  it('keeps no earnings at all as a missing component, not thin coverage', () => {
    const score = scoreEconomics([
      input(0, { earningsPerKm: null, lengthCoverage: { n: 0, of: 5 } }),
      ...complete(9).slice(1),
    ])[0];
    expect(score?.reason).toBe('missing_component');
  });
});

function randomRoutes(rng: SeededRandom, count: number): RouteRidershipInput[] {
  return Array.from({ length: count }, (_, i) => ({
    routeName: `R${rng.int(0, 99999)}_${i}`,
    serviceClass: rng.pick(CLASSES),
    buses: rng.int(0, 30),
    seatsPerBus: rng.int(0, 70),
    scheduledDurationMin: rng.bool(0.3) ? null : rng.int(20, 600),
    lengthKm: rng.bool(0.3) ? null : rng.float(1, 900),
  }));
}

describe('properties over seeded cases', () => {
  const seeds = Array.from({ length: CASES }, (_, i) => seedFor(`case-${i}`, '2026-10-06', 'props'));

  it('route totals reconcile exactly to the depot total, and the flat-fare shares are shares', () => {
    for (const seed of seeds) {
      const rng = new SeededRandom(seed);
      const { perRoute, depot: total } = analyseRevenue(
        modelRidershipDay(randomRoutes(rng, rng.int(1, 25)), '2026-10-06'),
      );
      expect(total.boardings).toBe(perRoute.reduce((n, r) => n + r.boardings, 0));
      expect(total.revenue).toBe(perRoute.reduce((n, r) => n + r.revenue, 0));
      expect(total.trips).toBe(perRoute.reduce((n, r) => n + r.trips, 0));
      for (const share of [total.flatFareRevenueShare, total.flatFareRouteShare]) {
        if (share !== null) expect(share).toBeGreaterThanOrEqual(0);
        if (share !== null) expect(share).toBeLessThanOrEqual(1);
      }
    }
  });

  it('never lets a load factor, route or depot, pass its cap', () => {
    for (const seed of seeds) {
      const rng = new SeededRandom(seed);
      const days = modelRidershipDay(randomRoutes(rng, 20), `2026-0${rng.int(1, 9)}-1${rng.int(0, 9)}`);
      for (const day of days) expect(day.loadFactor).toBeLessThanOrEqual(MAX_LOAD_FACTOR);
      const depotFactor = analyseRevenue(days).depot.loadFactor;
      if (depotFactor !== null) expect(depotFactor).toBeLessThanOrEqual(MAX_LOAD_FACTOR);
    }
  });

  it('moves the score the right way for each component', () => {
    const keys: readonly EconomicsComponentKey[] = ['earningsPerKm', 'costPerKm', 'loadFactor'];
    const direction: Record<EconomicsComponentKey, 1 | -1> = {
      earningsPerKm: 1,
      costPerKm: -1,
      loadFactor: 1,
    };
    const scale: Record<EconomicsComponentKey, number> = {
      earningsPerKm: 40,
      costPerKm: 30,
      loadFactor: 0.4,
    };
    for (const seed of seeds) {
      const rng = new SeededRandom(seed);
      const peers = Array.from({ length: rng.int(MIN_PEER_GROUP, 12) }, (_, i) =>
        input(i, {
          earningsPerKm: rng.float(10, 60),
          costPerKm: rng.float(10, 40),
          loadFactor: rng.float(0.2, 0.9),
        }),
      );
      const key = rng.pick(keys);
      const lower = rng.float(0, 1) * scale[key];
      const higher = lower + rng.float(0.01, 1) * scale[key];
      const at = (value: number): number | null =>
        scoreEconomics([{ ...(peers[0] as EconomicsInput), [key]: value }, ...peers.slice(1)])[0]
          ?.economicsIndex ?? null;
      const a = at(lower);
      const b = at(higher);
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      // Higher is better for earnings and load; lower is better for cost.
      expect(((b ?? 0) - (a ?? 0)) * direction[key]).toBeGreaterThanOrEqual(0);
    }
  });

  it('writes no NaN or Infinity anywhere for hostile inputs', () => {
    const hostileNumbers = [NaN, Infinity, -Infinity, -5, 0, 1e300, 1e-300];
    for (const seed of seeds) {
      const rng = new SeededRandom(seed);
      const routes = randomRoutes(rng, 8).map((r) => ({
        ...r,
        buses: rng.bool(0.3) ? rng.pick(hostileNumbers) : r.buses,
        seatsPerBus: rng.bool(0.3) ? rng.pick(hostileNumbers) : r.seatsPerBus,
        lengthKm: rng.bool(0.3) ? rng.pick(hostileNumbers) : r.lengthKm,
        scheduledDurationMin: rng.bool(0.3) ? rng.pick(hostileNumbers) : r.scheduledDurationMin,
      }));
      const analysis = analyseRevenue(modelRidershipDay(routes, '2026-10-06'));
      expect(nonFinite(analysis)).toBe(false);
      const scores = scoreEconomics(
        Array.from({ length: 8 }, (_, i) =>
          input(i, {
            earningsPerKm: rng.bool(0.3) ? rng.pick(hostileNumbers) : rng.float(1, 50),
            costPerKm: rng.bool(0.3) ? rng.pick(hostileNumbers) : rng.float(1, 50),
            loadFactor: rng.bool(0.3) ? rng.pick(hostileNumbers) : rng.float(0, 1),
            lengthCoverage: { n: rng.pick([NaN, 0, 1, 4]), of: rng.pick([NaN, 0, 4, 9]) },
          }),
        ),
      );
      expect(nonFinite(scores)).toBe(false);
    }
  });
});
