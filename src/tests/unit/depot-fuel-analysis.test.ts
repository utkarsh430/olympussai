import { describe, expect, it } from 'vitest';
import { analyseFuel } from '@/lib/depot/fuel/analysis';
import { formatRupees } from '@/lib/depot/fuel/format';
import {
  FUEL_REASON_LABELS,
  FUEL_VARIANCE_FLAG_PCT,
  type BusFuelDay,
} from '@/lib/depot/fuel/types';
import { modelFuelDay } from '@/lib/depot/sim/fuel';
import { modelBus } from '@/lib/depot/sim/fleetMaster';
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
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity|null.*null.*-/);
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

describe('analyseFuel: comparison group', () => {
  it('compares within the route at exactly three buses', () => {
    const f = figureOf([day('A', 5), day('B', 5), day('C', 4), day('X', 5, 'OTHER_ORD')], 'C');
    expect(f?.comparison).toBe('route');
    expect(f?.variancePct).toBe(25);
  });

  it('falls back to the depot at exactly two route buses', () => {
    const days = [day('A', 5), day('B', 4), day('X', 5, 'OTHER_ORD'), day('Y', 5, 'THIRD_ORD')];
    const f = figureOf(days, 'B');
    expect(f?.comparison).toBe('depot');
    expect(f?.variancePct).toBe(25);
  });

  it('withholds variance when even the depot has fewer than three similar buses', () => {
    const f = figureOf([day('A', 5), day('B', 4)], 'B');
    expect(f).toMatchObject({ variancePct: null, withheldReason: 'no_comparison_group' });
    expect(f?.kmPerLitre).toBeCloseTo(4, 0);
  });

  it('never compares across service classes', () => {
    const express: BusFuelDay = { ...day('E', 3), serviceClass: 'express' };
    const f = figureOf([day('A', 5), day('B', 5), express], 'E');
    expect(f?.variancePct).toBeNull();
  });
});

describe('analyseFuel: flags', () => {
  it('does not flag at exactly the limit and flags just above it', () => {
    expect(FUEL_VARIANCE_FLAG_PCT).toBe(15);
    // Median 23 km/l; 20 km/l is exactly 15% more fuel per km.
    const exact = analyseFuel([day('A', 23), day('B', 23), day('C', 20)], PRICE);
    expect(exact.perBus.find((b) => b.registrationNumber === 'C')?.variancePct).toBe(15);
    expect(exact.flagged).toEqual([]);
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
    expect(depot?.statement).toBe('uses 25% more fuel per kilometre than similar buses in this depot');
  });

  it('sorts flags by variance, worst first, then registration', () => {
    const days = [day('A', 5), day('B', 5), day('C', 5), day('Z', 4), day('M', 4), day('K', 3)];
    expect(analyseFuel(days, PRICE).flagged.map((f) => f.registrationNumber)).toEqual([
      'K',
      'M',
      'Z',
    ]);
  });

  it('never flags a bus that is better than its group', () => {
    expect(analyseFuel([day('A', 4), day('B', 4), day('C', 8)], PRICE).flagged).toEqual([]);
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
    const fleet = new Map(buses.map((b) => [b.registrationNumber, modelBus(b.registrationNumber, b.routeName)]));
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

  it('does not mutate input and ignores input order', () => {
    const frozen = Object.freeze(DAYS.map((d) => Object.freeze({ ...d })));
    const a = analyseFuel(frozen, PRICE);
    expect(analyseFuel([...DAYS].reverse(), PRICE)).toEqual(a);
    expect(analyseFuel([...DAYS].sort(() => 1), PRICE)).toEqual(a);
  });

  it('never says theft, pilferage, misuse, driver or conductor', () => {
    const result = analyseFuel(
      [...DAYS, { ...day('Q', 5), distanceKm: 0 }, { ...day('R', 5), fuelLitres: 0 }],
      PRICE,
    );
    const text = JSON.stringify([result, FUEL_REASON_LABELS]);
    expect(result.flagged.length).toBeGreaterThan(0);
    expect(text).not.toMatch(/theft|pilfer|misuse|driver|conductor/i);
  });
});

describe('formatRupees', () => {
  it('groups digits the Indian way and withholds non-finite values', () => {
    expect(formatRupees(1234567)).toBe('₹12,34,567');
    expect(formatRupees(950)).toBe('₹950');
    expect(formatRupees(0)).toBe('₹0');
    expect(formatRupees(Number.NaN)).toBe('—');
  });
});
