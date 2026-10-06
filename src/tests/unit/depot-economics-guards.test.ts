import { describe, it, expect } from 'vitest';
import { SeededRandom } from '@/lib/simulation/seededRandom';
import { analyseRevenue } from '@/lib/depot/revenue/analysis';
import { scoreEconomics } from '@/lib/depot/revenue/economicsIndex';
import type {
  EconomicsComponentKey,
  EconomicsInput,
} from '@/lib/depot/revenue/types';
import { MIN_PEER_GROUP } from '@/lib/depot/score/config';
import { MAX_LOAD_FACTOR } from '@/lib/depot/sim/revenueConfig';
import { modelRidershipDay } from '@/lib/depot/sim/ridership';
import { modelOperatingDay } from '@/lib/depot/sim/operatingDay';
import type { OperatingDay } from '@/lib/depot/sim/operatingDayTypes';
import type { DepotBusView } from '@/lib/depot/api';
import type { BusOpState } from '@/lib/depot/types';
import { seedFor } from '@/lib/depot/sim/seed';
import type { Coverage, DepotSummary } from '@/lib/depot/types';

const CASES = 150;

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

  // There is no coverage gate: earnings per km do not depend on a route's length,
  // so how many lengths are real is a coverage figure and never withholds a rank. The cases
  // the old gate refused (one route; a quarter but under two routes; 22%) now rank.
  it.each([
    [{ n: 0, of: 1 }, 'ok'], // no real length at all: every route on a modelled length
    [{ n: 1, of: 1 }, 'ok'],
    [{ n: 1, of: 4 }, 'ok'],
    [{ n: 2, of: 9 }, 'ok'],
    [{ n: 2, of: 8 }, 'ok'],
    [{ n: 0, of: 40 }, 'ok'],
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

  it('keeps no earnings at all as a missing component, whatever the coverage', () => {
    const score = scoreEconomics([
      input(0, { earningsPerKm: null, lengthCoverage: { n: 0, of: 5 } }),
      ...complete(9).slice(1),
    ])[0];
    expect(score?.reason).toBe('missing_component');
  });
});

const STATES: readonly BusOpState[] = ['in_service', 'on_road', 'standing', 'dark', 'off_road'];
const NAMES: readonly string[] = ['A_EXP_1', 'B_ORD_2', 'C_AC_3', 'D_VOLVO_4', 'E_5'];

/** A seeded depot's operating day; `length` draws each route's real length (or none). */
function randomDay(rng: SeededRandom, buses: number, date: string, length: () => number | null): OperatingDay {
  const views = Array.from({ length: buses }, (_, i) => ({
    registrationNumber: `UP${rng.int(0, 99999)}Z${i}`,
    state: rng.pick(STATES),
    routeName: rng.bool(0.15) ? null : rng.pick(NAMES),
  })) as unknown as DepotBusView[];
  return modelOperatingDay({
    depot: depot(`p${rng.int(0, 9999)}`),
    buses: views,
    peakRequirement: rng.int(0, 40),
    realLengthKm: new Map(NAMES.map((name) => [name, length()] as const)),
    operatingDate: date,
  });
}

describe('properties over seeded cases', () => {
  const seeds = Array.from({ length: CASES }, (_, i) => seedFor(`case-${i}`, '2026-10-06', 'props'));

  it('route totals reconcile exactly to the depot total, and the modelled-length share is a share', () => {
    for (const seed of seeds) {
      const rng = new SeededRandom(seed);
      const day = randomDay(rng, rng.int(0, 40), '2026-10-06', () =>
        rng.bool(0.3) ? null : rng.float(1, 900),
      );
      const { perRoute, depot: total } = analyseRevenue(modelRidershipDay(day));
      expect(total.boardings).toBe(perRoute.reduce((n, r) => n + r.boardings, 0));
      expect(total.revenue).toBe(perRoute.reduce((n, r) => n + r.revenue, 0));
      expect(total.trips).toBe(perRoute.reduce((n, r) => n + r.trips, 0));
      expect(total.lengthCoverage.n).toBe(perRoute.filter((r) => r.lengthProvenance === 'derived').length);
      expect(total.lengthCoverage.of).toBe(perRoute.length);
      const share = total.modelledLengthRevenueShare;
      if (share !== null) expect(share).toBeGreaterThanOrEqual(0);
      if (share !== null) expect(share).toBeLessThanOrEqual(1);
    }
  });

  it('never lets a load factor, route or depot, pass its cap', () => {
    for (const seed of seeds) {
      const rng = new SeededRandom(seed);
      const date = `2026-0${rng.int(1, 9)}-1${rng.int(0, 9)}`;
      const days = modelRidershipDay(randomDay(rng, 40, date, () => rng.float(1, 900)));
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
    const strictMoves = new Map<EconomicsComponentKey, number>();
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
      const move = ((b ?? 0) - (a ?? 0)) * direction[key];
      expect(move).toBeGreaterThanOrEqual(0);
      if (move > 0) strictMoves.set(key, (strictMoves.get(key) ?? 0) + 1);
    }
    // A component whose weight is zero never moves the score; every one must, at least once.
    expect(keys.filter((key) => (strictMoves.get(key) ?? 0) === 0)).toEqual([]);
  });

  it('writes no NaN or Infinity anywhere for hostile inputs', () => {
    const hostileNumbers = [NaN, Infinity, -Infinity, -5, 0, 1e300, 1e-300];
    for (const seed of seeds) {
      const rng = new SeededRandom(seed);
      // The day's only numeric input from outside is a route's real length; hostile ones
      // fall back to the modelled length or run no kilometres, and never reach a NaN.
      const day = randomDay(rng, 12, '2026-10-06', () =>
        rng.bool(0.5) ? rng.pick(hostileNumbers) : rng.float(1, 900),
      );
      const analysis = analyseRevenue(modelRidershipDay(day));
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
