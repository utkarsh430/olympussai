import { describe, expect, it } from 'vitest';
import type { DepotBusRow } from '@/models/depotLive';
import { distanceM } from '@/lib/depot/infer/geo';
import type { Yard } from '@/lib/depot/infer/types';
import { inferYard, inferYards, YARD_MIN_CLUSTER } from '@/lib/depot/infer/yard';
import { YARD_HOLD_MAX_HOURS } from '@/lib/depot/infer/yardContinuity';
import {
  applyYardContinuity,
  createYardMemoryStore,
  type YardMemoryStore,
} from '@/lib/depot/infer/yardMemory';
import { blob, busAt, row, seededRandom, type XY } from './depot-yard.fixtures';

const T0 = Date.parse('2026-10-06T06:00:00.000Z');
const at = (hours: number): string => new Date(T0 + hours * 3_600_000).toISOString();

/** Two stands five kilometres apart: the depot's yard, and a terminal that fills up. */
const A: XY = { x: 0, y: 0 };
const B: XY = { x: 5000, y: 0 };

function stands(a: number, b: number, depotId = '1'): DepotBusRow[] {
  return [
    ...blob(`${depotId}A`, a, A, 20, { depotId }),
    ...blob(`${depotId}B`, b, B, 20, { depotId }),
    // Neither is evidence: one is moving, one has no position.
    busAt(`${depotId}M`, A, { depotId, speedKmph: 40 }),
    row({ registrationNumber: `${depotId}U`, depotId, latitude: null, longitude: null }),
  ];
}

function step(
  store: YardMemoryStore,
  rows: readonly DepotBusRow[],
  feedNow: string | null,
): ReadonlyMap<string, Yard> {
  return applyYardContinuity(store, rows, inferYards(rows), feedNow);
}

const ruleYardAt = (rows: readonly DepotBusRow[]): Yard => inferYard(rows) as Yard;
const yardA = ruleYardAt(stands(12, 0));
const yardB = ruleYardAt(stands(0, 12));
const isAt = (yard: Yard | undefined, place: Yard): boolean =>
  yard !== undefined && distanceM(yard.lat, yard.lng, place.lat, place.lng) < 100;

describe('yard continuity', () => {
  it('keeps the yard, marked held, while the second stand grows to equal and then larger', () => {
    const store = createYardMemoryStore();
    const first = step(store, stands(12, 6), at(0)).get('1');
    expect(isAt(first, yardA)).toBe(true);
    expect(first?.heldSince).toBeUndefined();

    expect(inferYard(stands(12, 12))).toBeNull();
    const equal = step(store, stands(12, 12), at(1)).get('1');
    expect(isAt(equal, yardA)).toBe(true);
    expect(equal).toMatchObject({ heldSince: at(1), inCluster: 12, parked: 24 });

    expect(isAt(ruleYardAt(stands(12, 20)), yardB)).toBe(true);
    const larger = step(store, stands(12, 20), at(2)).get('1');
    expect(isAt(larger, yardA)).toBe(true);
    expect(larger).toMatchObject({ heldSince: at(1), inCluster: 12, parked: 32 });
  });

  it('ends the hold when fewer than six buses stand in it; the next yard can be elsewhere', () => {
    const store = createYardMemoryStore();
    step(store, stands(12, 6), at(0));
    const six = step(store, stands(YARD_MIN_CLUSTER, 20), at(1)).get('1');
    expect(isAt(six, yardA)).toBe(true);
    expect(six?.heldSince).toBe(at(1));
    const five = step(store, stands(YARD_MIN_CLUSTER - 1, 20), at(2)).get('1');
    expect(isAt(five, yardB)).toBe(true);
    expect(five?.heldSince).toBeUndefined();
    // And with nothing dominant once the hold has ended, there is no yard at all.
    const other = createYardMemoryStore();
    step(other, stands(12, 6), at(0));
    expect(step(other, stands(5, 5), at(1)).has('1')).toBe(false);
    expect(other.byDepot.has('1')).toBe(false);
  });

  it('ends the hold twelve hours of feed time after it began', () => {
    const store = createYardMemoryStore();
    step(store, stands(12, 6), at(0));
    step(store, stands(12, 20), at(1));
    const atLimit = step(store, stands(12, 20), at(1 + YARD_HOLD_MAX_HOURS)).get('1');
    expect(isAt(atLimit, yardA)).toBe(true);
    const past = step(store, stands(12, 20), at(1.01 + YARD_HOLD_MAX_HOURS)).get('1');
    expect(isAt(past, yardB)).toBe(true);
    expect(past?.heldSince).toBeUndefined();
  });

  it('replaces the remembered yard, unheld, when the rule gives an overlapping one', () => {
    const store = createYardMemoryStore();
    step(store, stands(12, 6), at(0));
    step(store, stands(12, 12), at(1));
    const back = step(store, stands(14, 6), at(2)).get('1');
    expect(back).toEqual(inferYard(stands(14, 6)));
    expect(step(store, stands(14, 14), at(3)).get('1')?.heldSince).toBe(at(3));
  });

  it('needs the full rule in a process that has just started', () => {
    expect(step(createYardMemoryStore(), stands(12, 12), at(0)).has('1')).toBe(false);
  });

  it('is unchanged by a repeated snapshot, and neither read nor fed by an older or clockless one', () => {
    const store = createYardMemoryStore();
    step(store, stands(12, 6), at(1));
    step(store, stands(12, 12), at(2));
    const before = JSON.stringify([store.lastFeedMs, [...store.byDepot]]);
    expect(step(store, stands(12, 12), at(2)).get('1')?.heldSince).toBe(at(2));
    expect(step(store, stands(12, 12), at(0)).has('1')).toBe(false);
    expect(isAt(step(store, stands(0, 12), at(0)).get('1'), yardB)).toBe(true);
    expect(step(store, stands(12, 12), null).has('1')).toBe(false);
    expect(JSON.stringify([store.lastFeedMs, [...store.byDepot]])).toBe(before);
  });

  it('does not depend on the order of depots or of rows', () => {
    const sequence = [[12, 6], [12, 12], [12, 20], [5, 20], [9, 9]] as const;
    const run = (arrange: (rows: DepotBusRow[]) => DepotBusRow[]): string => {
      const store = createYardMemoryStore();
      return JSON.stringify(
        sequence.map(([a, b], i) => {
          const rows = arrange([...stands(a, b, '1'), ...stands(b, a, '2')]);
          return [...step(store, rows, at(i))].sort(([x], [y]) => (x < y ? -1 : 1));
        }),
      );
    };
    expect(run((rows) => [...rows].reverse())).toBe(run((rows) => rows));
  });

  it('holds its properties over many seeded sequences', () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const run = (): string => {
        const random = seededRandom(seed);
        const store = createYardMemoryStore();
        const out: unknown[] = [];
        let previous: Yard | undefined;
        for (let i = 0; i < 60; i += 1) {
          const rows = stands(Math.floor(random() * 16), Math.floor(random() * 16));
          // Mostly forward in time, with repeats and steps back mixed in.
          const feedNow = at(i * 0.3 - (i % 5 === 0 ? 1 : 0));
          const yard = step(store, rows, feedNow).get('1');
          if (yard?.heldSince !== undefined) {
            expect(yard.inCluster).toBeGreaterThanOrEqual(YARD_MIN_CLUSTER);
            const heldMs = Date.parse(feedNow) - Date.parse(yard.heldSince);
            expect(heldMs).toBeGreaterThanOrEqual(0);
            expect(heldMs).toBeLessThanOrEqual(YARD_HOLD_MAX_HOURS * 3_600_000);
            // A held yard does not move: its centre stays inside the yard it continues.
            const from = previous as Yard;
            expect(distanceM(yard.lat, yard.lng, from.lat, from.lng)).toBeLessThanOrEqual(
              from.radiusM,
            );
          }
          // Every fifth step is older than the one before it, so it is not remembered.
          if (i === 0 || i % 5 !== 0) previous = yard;
          expect(store.byDepot.size).toBeLessThanOrEqual(1);
          out.push(yard ?? null);
        }
        return JSON.stringify(out);
      };
      expect(run()).toBe(run());
    }
  });
});
