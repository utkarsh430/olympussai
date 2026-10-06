import { describe, expect, it } from 'vitest';
import type { DepotBusRow } from '@/models/depotLive';
import { inferYards } from '@/lib/depot/infer/yard';
import { applyYardContinuity, createYardMemoryStore } from '@/lib/depot/infer/yardMemory';
import { blob, type XY } from './depot-yard.fixtures';

/*
 * Ruling S56b for the yard memory (N4): a snapshot more than one window behind
 * the newest is decided against the memory and never writes it; the third such
 * snapshot in a row starts a new epoch (the memory is emptied, then written),
 * so a clock that really went back does not leave the memory read-only, with
 * entries from the future deciding every depot, for hours. The fixture never
 * reads, writes or counts.
 */

const T0 = Date.parse('2026-10-06T06:00:00.000Z');
const atMin = (minutes: number): string => new Date(T0 + minutes * 60_000).toISOString();
const A: XY = { x: 0, y: 0 };
const B: XY = { x: 3000, y: 0 };

type Store = ReturnType<typeof createYardMemoryStore>;

function standingAt(at: XY, feedNow: string): DepotBusRow[] {
  return blob('Y', 12, at, 20, { depotId: '1' }).map((r) => ({ ...r, gpsTimestamp: feedNow }));
}

function step(store: Store, rows: DepotBusRow[], feedNow: string, fixture = false) {
  return applyYardContinuity(store, rows, inferYards(rows), feedNow, { fixture }).get('1');
}

const yardLng = (store: Store): number | undefined => store.byDepot.get('1')?.yard.lng;

describe('yard memory epochs (S56b, N4)', () => {
  it('starts a new epoch on the third snapshot in a row more than a window behind', () => {
    const store = createYardMemoryStore();
    // The clock ran 5 h 30 ahead, and the memory learned yard A there.
    step(store, standingAt(A, atMin(330)), atMin(330));
    step(store, standingAt(A, atMin(331)), atMin(331));
    const future = store.byDepot.get('1');
    // The clock really goes back; the depot's buses now stand at B.
    step(store, standingAt(B, atMin(0)), atMin(0));
    step(store, standingAt(B, atMin(1)), atMin(1));
    expect(store.byDepot.get('1')).toBe(future);
    expect(store.lastFeedMs).toBe(T0 + 331 * 60_000);
    const third = step(store, standingAt(B, atMin(2)), atMin(2));
    expect(store.lastFeedMs).toBe(T0 + 2 * 60_000);
    expect(store.byDepot.get('1')).toEqual({ yard: third, seenMs: T0 + 2 * 60_000 });
    expect(yardLng(store)).not.toBe(future?.yard.lng);
    step(store, standingAt(B, atMin(3)), atMin(3));
    expect(store.lastFeedMs).toBe(T0 + 3 * 60_000);
  });

  it('keeps the live memory beside a backend stuck 25 minutes behind', () => {
    const store = createYardMemoryStore();
    for (let i = 0; i < 6; i += 1) {
      const live = 60 + i;
      step(store, standingAt(A, atMin(live)), atMin(live));
      const before = store.byDepot.get('1');
      step(store, standingAt(B, atMin(live - 25)), atMin(live - 25));
      expect(store.byDepot.get('1')).toBe(before);
      expect(store.lastFeedMs).toBe(T0 + live * 60_000);
    }
  });

  it('two stragglers then a current snapshot start no epoch', () => {
    const store = createYardMemoryStore();
    step(store, standingAt(A, atMin(60)), atMin(60));
    step(store, standingAt(B, atMin(0)), atMin(0));
    step(store, standingAt(B, atMin(1)), atMin(1));
    step(store, standingAt(A, atMin(61)), atMin(61));
    step(store, standingAt(B, atMin(2)), atMin(2));
    expect(store.lastFeedMs).toBe(T0 + 61 * 60_000);
  });

  it('never lets the fixture read, write or count', () => {
    const store = createYardMemoryStore();
    step(store, standingAt(A, atMin(60)), atMin(60));
    const before = store.byDepot.get('1');
    for (const at of [0, 1, 2, 3]) {
      expect(step(store, standingAt(B, atMin(at)), atMin(at), true)).toEqual(
        inferYards(standingAt(B, atMin(at))).get('1'),
      );
    }
    expect(store.byDepot.get('1')).toBe(before);
    expect(store.lastFeedMs).toBe(T0 + 60 * 60_000);
    const fresh = createYardMemoryStore();
    step(fresh, standingAt(A, atMin(0)), atMin(0), true);
    expect(fresh.byDepot.size).toBe(0);
    expect(fresh.lastFeedMs).toBeNull();
  });
});
