import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyseFuel } from '@/lib/depot/fuel/analysis';
import { isSupportedMedian } from '@/lib/depot/fuel/support';
import {
  DEFAULT_PRICE_PER_LITRE,
  FUEL_REASON_LABELS,
  FUEL_VARIANCE_FLAG_PCT,
  type BusFuelDay,
} from '@/lib/depot/fuel/types';
import { modelFuelDay } from '@/lib/depot/sim/fuel';
import { modelBus } from '@/lib/depot/sim/fleetMaster';
import { seedFor } from '@/lib/depot/sim/seed';
import { SeededRandom } from '@/lib/simulation/seededRandom';
import type { DepotBusView } from '@/lib/depot/api';

const PRICE = 100;
const ROUTE = 'PUNE_ORD_X';
const DISTANCE = 230;

/** A bus that runs 230 km at the given kilometres per litre (litres to 1 dp). */
function day(
  reg: string,
  kmPerLitre: number,
  routeName: string | null = ROUTE,
  distanceKm = DISTANCE,
): BusFuelDay {
  return {
    registrationNumber: reg,
    distanceKm,
    fuelLitres: Math.round((distanceKm / kmPerLitre) * 10) / 10,
    serviceClass: 'ordinary',
    routeName,
  };
}

const figureOf = (days: readonly BusFuelDay[], reg: string) =>
  analyseFuel(days, PRICE).perBus.find((b) => b.registrationNumber === reg);

describe('analyseFuel: zero and hostile inputs', () => {
  it('gives null figures and no_distance for a bus with no distance', () => {
    const f = figureOf([{ ...day('A', 5), distanceKm: 0, fuelLitres: 0 }], 'A');
    expect(f).toMatchObject({
      kmPerLitre: null,
      costPerKm: null,
      variancePct: null,
      withheldReason: 'no_distance',
    });
  });

  it('treats negative and non-finite distance or litres as defined, finite results', () => {
    const hostile: BusFuelDay[] = [
      { ...day('A', 5), distanceKm: -50 },
      { ...day('B', 5), distanceKm: Number.NaN },
      { ...day('C', 5), distanceKm: Number.POSITIVE_INFINITY },
      { ...day('D', 5), fuelLitres: -3 },
      { ...day('E', 5), fuelLitres: Number.NaN },
      { ...day('F', 5), fuelLitres: Number.POSITIVE_INFINITY },
    ];
    const result = analyseFuel(hostile, Number.NaN);
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
    for (const b of result.perBus) {
      for (const v of [b.kmPerLitre, b.costPerKm, b.variancePct]) {
        expect(v === null || Number.isFinite(v)).toBe(true);
      }
    }
    expect(result.perBus.slice(0, 3).every((b) => b.withheldReason === 'no_distance')).toBe(true);
    expect(result.perBus.slice(3).every((b) => b.withheldReason === 'no_fuel')).toBe(true);
    expect(result.depot.cost).toBeGreaterThanOrEqual(0);
  });

  it('handles an empty list', () => {
    const result = analyseFuel([], PRICE);
    expect(result.perBus).toEqual([]);
    expect(result.flagged).toEqual([]);
    expect(result.depot).toMatchObject({
      distanceKm: 0,
      fuelLitres: 0,
      cost: 0,
      kmPerLitre: null,
      costPerKm: null,
      busCount: 0,
    });
  });
});

describe('analyseFuel: comparison group (peers exclude the bus itself)', () => {
  it('compares within the route when at least two peers have distance', () => {
    const f = figureOf([day('A', 5), day('B', 5), day('C', 4), day('X', 5, 'OTHER_ORD')], 'C');
    expect(f?.comparison).toBe('route');
    expect(f?.variancePct).toBe(25);
  });

  it('falls back to the depot at exactly one route peer', () => {
    const days = [day('A', 5), day('B', 4), day('X', 5, 'OTHER_ORD'), day('Y', 5, 'THIRD_ORD')];
    const f = figureOf(days, 'B');
    expect(f?.comparison).toBe('depot');
    expect(f?.variancePct).toBe(25);
  });

  it('gives no comparison at exactly one peer in the depot', () => {
    const f = figureOf([day('A', 5), day('B', 4)], 'B');
    expect(f).toMatchObject({ variancePct: null, withheldReason: 'no_comparison_group' });
    expect(f?.kmPerLitre).toBeCloseTo(4, 0);
  });

  it('does not count a peer with no distance', () => {
    const idle: BusFuelDay = { ...day('C', 5), distanceKm: 0, fuelLitres: 0 };
    expect(figureOf([day('A', 5), day('B', 4), idle], 'B')?.variancePct).toBeNull();
  });

  it('never compares across service classes', () => {
    const express: BusFuelDay = { ...day('E', 3), serviceClass: 'express' };
    const f = figureOf([day('A', 5), day('B', 5), express], 'E');
    expect(f?.variancePct).toBeNull();
  });

  it('shows a variance but flags nobody when the poor buses are two of three: [5, 3, 3]', () => {
    const result = analyseFuel([day('A', 5), day('B', 3), day('C', 3)], PRICE);
    expect(result.flagged).toEqual([]);
    const b = result.perBus.find((x) => x.registrationNumber === 'B');
    expect(b?.variancePct).toBeCloseTo(33, 0); // litres are rounded to one decimal
    expect(b?.withheldReason).toBe('peers_differ');
    const a = result.perBus.find((x) => x.registrationNumber === 'A');
    expect(a?.variancePct).toBeLessThan(0);
    expect(a?.withheldReason).toBeNull();
  });

  it('flags the single outlier: [5, 5, 3]', () => {
    const result = analyseFuel([day('A', 5), day('B', 5), day('C', 3)], PRICE);
    expect(result.flagged.map((f) => f.registrationNumber)).toEqual(['C']);
  });

  it('sends a bus with no route straight to the depot comparison', () => {
    const days = [day('A', 5, null), day('B', 5, 'R1'), day('C', 5, 'R2'), day('D', 4, null)];
    const result = analyseFuel(days, PRICE);
    const d = result.perBus.find((b) => b.registrationNumber === 'D');
    expect(d).toMatchObject({ comparison: 'depot', variancePct: 25 });
    expect(result.flagged[0]?.statement).toBe(
      'uses 25% more fuel per kilometre than similar buses of its class in this depot',
    );
  });
});

const flaggedFor = (kmPerLitre: readonly number[]): string[] =>
  analyseFuel(
    kmPerLitre.map((km, i) => day(`B${i}`, km)),
    PRICE,
  ).flagged.map((f) => f.registrationNumber);

describe('isSupportedMedian', () => {
  it('needs at least two peers within the flag threshold of their median', () => {
    expect(isSupportedMedian([4, 8])).toBe(false); // median 6, both 33% away
    expect(isSupportedMedian([5, 3])).toBe(false); // median 4, both 25% away
    expect(isSupportedMedian([5, 5])).toBe(true);
    expect(isSupportedMedian([5, 5, 3])).toBe(true);
    expect(isSupportedMedian([5, 4])).toBe(true); // median 4.5, both 11.1% away
    expect(isSupportedMedian([5, 3, 3, 5])).toBe(false); // median 4: all 25% away
  });

  it('is false for fewer than two peers and for a non-positive median', () => {
    expect(isSupportedMedian([])).toBe(false);
    expect(isSupportedMedian([5])).toBe(false);
    expect(isSupportedMedian([0, 0])).toBe(false);
  });

  it('counts a peer exactly at the threshold as within it', () => {
    // Median of [20, 23] is 21.5; 23 is 6.98% away, 20 is 6.98% away: both within.
    expect(isSupportedMedian([20, 23])).toBe(true);
    // Median 100; 85 is exactly 15% away and 115 is exactly 15% away.
    expect(isSupportedMedian([85, 100, 115])).toBe(true);
    expect(isSupportedMedian([84, 100, 116])).toBe(false);
  });
});

describe('analyseFuel: a flag needs a supported peer median', () => {
  it('flags none for [4, 4, 8]: each 4 has peers 4 and 8, median 6', () => {
    expect(flaggedFor([4, 4, 8])).toEqual([]);
    const f = figureOf([day('A', 4), day('B', 4), day('C', 8)], 'A');
    expect(f?.variancePct).toBeCloseTo(50, 0); // litres are rounded to one decimal
    expect(f?.withheldReason).toBe('peers_differ');
  });

  it('flags none for [5, 3, 3]', () => {
    expect(flaggedFor([5, 3, 3])).toEqual([]);
  });

  it('flags the 3 for [5, 5, 3]', () => {
    expect(flaggedFor([5, 5, 3])).toEqual(['B2']);
  });

  it('flags both 3s for [5, 5, 3, 3]', () => {
    expect(flaggedFor([5, 5, 3, 3])).toEqual(['B2', 'B3']);
  });

  it('flags the 3 for [5, 4, 3]: peers 5 and 4 are both 11.1% from their median 4.5', () => {
    // |5 - 4.5| / 4.5 = 11.1% and |4 - 4.5| / 4.5 = 11.1%, both within 15%.
    expect(flaggedFor([5, 4, 3])).toEqual(['B2']);
  });

  it('flags a bus with exactly two peers only when the two agree', () => {
    expect(flaggedFor([5, 5, 4])).toEqual(['B2']);
    expect(flaggedFor([8, 4, 4.5])).toEqual([]);
  });

  it('gives a reason only to a bus that would have been flagged without the rule', () => {
    const result = analyseFuel([day('A', 4), day('B', 4), day('C', 8)], PRICE);
    const reasons = result.perBus.map((b) => [b.registrationNumber, b.withheldReason]);
    expect(reasons).toEqual([
      ['A', 'peers_differ'],
      ['B', 'peers_differ'],
      ['C', null],
    ]);
    expect(FUEL_REASON_LABELS.peers_differ).toBe('peers differ too much to compare');
  });

  it('keeps the figure and the variance on a bus whose peers differ', () => {
    const f = figureOf([day('A', 4), day('B', 4), day('C', 8)], 'A');
    expect(f?.kmPerLitre).toBeCloseTo(4, 0);
    expect(f?.comparison).toBe('route');
  });
});

describe('analyseFuel: flags', () => {
  it('does not flag at exactly the limit and flags just above it', () => {
    expect(FUEL_VARIANCE_FLAG_PCT).toBe(15);
    // Peer median 23 km/l; 20 km/l is exactly 15% more fuel per km.
    const exact = analyseFuel([day('A', 23), day('B', 23), day('C', 20)], PRICE);
    expect(exact.perBus.find((b) => b.registrationNumber === 'C')?.variancePct).toBe(15);
    expect(exact.flagged.map((f) => f.registrationNumber)).not.toContain('C');
    const above = analyseFuel([day('A', 23), day('B', 23), day('C', 19.8)], PRICE);
    expect(above.flagged.map((f) => f.registrationNumber)).toEqual(['C']);
  });

  it('words a flag as a variance on the route or in the depot, never a cause', () => {
    const route = analyseFuel([day('A', 5), day('B', 5), day('C', 4)], PRICE).flagged[0];
    expect(route?.statement).toBe(
      'uses 25% more fuel per kilometre than similar buses on this route',
    );
    const depot = analyseFuel(
      [day('A', 5), day('B', 4), day('X', 5, 'O1'), day('Y', 5, 'O2')],
      PRICE,
    ).flagged[0];
    expect(depot?.statement).toBe(
      'uses 25% more fuel per kilometre than similar buses of its class in this depot',
    );
  });

  it('sorts flags by variance, worst first, then registration', () => {
    const fives = ['A', 'B', 'C', 'D', 'E'].map((r) => day(r, 5));
    const days = [...fives, day('Z', 4), day('M', 4), day('K', 3)];
    expect(analyseFuel(days, PRICE).flagged.map((f) => f.registrationNumber)).toEqual([
      'K',
      'M',
      'Z',
    ]);
  });

  it('shows a bus better than its peers as negative and unflagged', () => {
    const result = analyseFuel([day('A', 5), day('B', 5), day('C', 8)], PRICE);
    expect(result.perBus.find((b) => b.registrationNumber === 'C')?.variancePct).toBeLessThan(0);
    expect(result.flagged.map((f) => f.registrationNumber)).not.toContain('C');
  });
});

describe('analyseFuel: price', () => {
  it.each([Number.NaN, -5, 0, Number.POSITIVE_INFINITY])('defaults a bad price %s', (price) => {
    const result = analyseFuel([day('A', 5)], price);
    expect(result.priceDefaulted).toBe(true);
    expect(result.pricePerLitre).toBe(DEFAULT_PRICE_PER_LITRE);
  });

  it('uses a valid price as given', () => {
    const result = analyseFuel([day('A', 5)], 80);
    expect(result).toMatchObject({ priceDefaulted: false, pricePerLitre: 80 });
  });
});

describe('analyseFuel: counts and ordering', () => {
  it('counts every bus in busCount, including those with no distance', () => {
    const idle: BusFuelDay = { ...day('B', 5), distanceKm: 0, fuelLitres: 0 };
    const result = analyseFuel([day('A', 5), idle], PRICE);
    expect(result.depot.busCount).toBe(2);
    expect(result.perRoute[0]?.busCount).toBe(2);
  });

  it('orders registrations and keys by plain code-point comparison', () => {
    const regs = ['b', 'B', 'a', '10', '9', 'Z'];
    const days = regs.map((r) => day(r, 5, `r${r}`));
    const result = analyseFuel(days, PRICE);
    const expected = ['10', '9', 'B', 'Z', 'a', 'b'];
    expect(result.perBus.map((b) => b.registrationNumber)).toEqual(expected);
    expect(result.perRoute.map((r) => r.key)).toEqual(expected.map((r) => `r${r}`));
    const fuel = modelFuelDay(
      regs.map((r) => ({ registrationNumber: r, state: 'on_road', routeName: null })) as never,
      new Map(),
      '2026-10-06',
    );
    expect(fuel.map((d) => d.registrationNumber)).toEqual(expected);
  });
});

describe('analyseFuel: totals', () => {
  it('uses the ratio of sums, not the mean of ratios', () => {
    // 100 km on 10 L (10 km/l) and 900 km on 300 L (3 km/l): mean of ratios 6.5, ratio of sums 3.33.
    const days = [
      { ...day('A', 10, ROUTE, 100), fuelLitres: 10 },
      { ...day('B', 3, ROUTE, 900), fuelLitres: 300 },
    ];
    const row = analyseFuel(days, PRICE).perRoute[0];
    expect(row).toMatchObject({ distanceKm: 1000, fuelLitres: 310, cost: 31000, busCount: 2 });
    expect(row?.kmPerLitre).toBeCloseTo(1000 / 310, 10);
    expect(row?.costPerKm).toBeCloseTo(31, 10);
  });

  it('reconciles buses, classes, routes and depot in litres and rupees', () => {
    const buses = Array.from({ length: 60 }, (_, i) => ({
      registrationNumber: `UP32CD${2000 + i}`,
      state: i % 9 === 0 ? 'off_road' : 'on_road',
      routeName: ['PUNE_EXP_X', 'AKOLA_ORD_Y', 'MUM_VOLVO_AC', null][i % 4] ?? null,
    })) as unknown as DepotBusView[];
    const fleet = new Map(
      buses.map((b) => [b.registrationNumber, modelBus(b.registrationNumber, b.routeName)]),
    );
    const result = analyseFuel(modelFuelDay(buses, fleet, '2026-10-06'), 91.37);
    const tenths = (n: number): number => Math.round(n * 10);
    const litres = result.perBus.reduce((s, b) => s + tenths(b.fuelLitres), 0);
    const cost = result.perBus.reduce((s, b) => s + b.cost, 0);
    for (const rows of [result.perClass, result.perRoute]) {
      expect(rows.reduce((s, r) => s + tenths(r.fuelLitres), 0)).toBe(litres);
      expect(rows.reduce((s, r) => s + r.cost, 0)).toBe(cost);
      expect(rows.reduce((s, r) => s + r.busCount, 0)).toBe(60);
    }
    expect(tenths(result.depot.fuelLitres)).toBe(litres);
    expect(result.depot.cost).toBe(cost);
    expect(Number.isInteger(result.depot.cost)).toBe(true);
  });
});

describe('analyseFuel: purity and wording', () => {
  const DAYS = [day('A', 5), day('B', 5), day('C', 4), day('D', 3), day('E', 5, 'OTHER_ORD')];

  function shuffled<T>(items: readonly T[], seed: string): T[] {
    const rng = new SeededRandom(seedFor('fuel-shuffle', '2026-10-06', seed));
    const out = [...items];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = rng.int(0, i);
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  }

  it('does not mutate input and ignores input order', () => {
    const frozen = Object.freeze(DAYS.map((d) => Object.freeze({ ...d })));
    const a = analyseFuel(frozen, PRICE);
    expect(analyseFuel([...DAYS].reverse(), PRICE)).toEqual(a);
    for (const seed of ['one', 'two', 'three']) {
      expect(analyseFuel(shuffled(DAYS, seed), PRICE)).toEqual(a);
    }
  });

  function everyString(): string {
    const result = analyseFuel(
      [...DAYS, { ...day('Q', 5), distanceKm: 0 }, { ...day('R', 5), fuelLitres: 0 }],
      PRICE,
    );
    expect(result.flagged.length).toBeGreaterThan(0);
    return JSON.stringify([result, FUEL_REASON_LABELS]);
  }

  it('never says theft, pilferage, misuse, driver or conductor', () => {
    expect(everyString()).not.toMatch(/theft|pilfer|misuse|driver|conductor/i);
  });

  it('names no cause or person in output or in the fuel source comments', () => {
    const cause =
      /engine|tyre|tire|weight|equipment|\bload|traffic|driving|crew|operator|\bfault|leak|tamper/i;
    expect(everyString()).not.toMatch(cause);
    for (const file of ['sim/fuelConfig.ts', 'sim/fuel.ts', 'fuel/types.ts', 'fuel/analysis.ts']) {
      const source = readFileSync(join(process.cwd(), 'src/lib/depot', file), 'utf8');
      expect(source, file).not.toMatch(cause);
    }
  });
});
