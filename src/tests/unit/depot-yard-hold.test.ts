import { describe, expect, it } from 'vitest';
import type { DepotBusRow } from '@/models/depotLive';
import type { Yard } from '@/lib/depot/infer/types';
import { inferYard, inferYards } from '@/lib/depot/infer/yard';
import { YARD_HOLD_MAX_HOURS } from '@/lib/depot/infer/yardContinuity';
import { applyYardContinuity, createYardMemoryStore } from '@/lib/depot/infer/yardMemory';
import { REPORTING_WINDOW_MIN } from '@/lib/depot/infer/thresholds';
import { blob, busAt, type XY } from './depot-yard.fixtures';

/*
 * Ruling S50c: during a hold the established circle stays fixed (I3); a repeat
 * returns the remembered yard (I4); an entry older than the hold cap is
 * nothing remembered (M1); and only buses heard recently are hold evidence (M9).
 */

const T0 = Date.parse('2026-10-06T06:00:00.000Z');
const atMin = (minutes: number): string => new Date(T0 + minutes * 60_000).toISOString();
const atHours = (hours: number): string => atMin(hours * 60);

const A: XY = { x: 0, y: 0 };
const RIVAL: XY = { x: 2000, y: 0 };

function heardAt(rows: readonly DepotBusRow[], gpsTimestamp: string): DepotBusRow[] {
  return rows.map((r) => ({ ...r, gpsTimestamp }));
}

function step(
  store: ReturnType<typeof createYardMemoryStore>,
  rows: DepotBusRow[],
  feedNow: string,
) {
  return applyYardContinuity(store, rows, inferYards(rows), feedNow).get('1');
}

/** A core of ten at A and an equal rival stand 2 km away: the rule refuses to choose. */
const tied = (extra: readonly DepotBusRow[] = []): DepotBusRow[] => [
  ...blob('A', 10, A, 20, { depotId: '1' }),
  ...blob('R', 10, RIVAL, 20, { depotId: '1' }),
  ...extra,
];

describe('yard hold (S50c)', () => {
  it('never grows or moves a held yard, with a bus at its edge on every poll (I3)', () => {
    const store = createYardMemoryStore();
    const first = step(store, heardAt(blob('A', 10, A, 20, { depotId: '1' }), atMin(0)), atMin(0));
    expect(first).toBeDefined();
    const established = first as Yard;
    expect(inferYard(tied())).toBeNull();
    for (let poll = 1; poll <= 60; poll += 1) {
      const feedNow = atMin(poll * 0.67);
      // One bus just inside the circle, in a new direction each poll.
      const angle = poll * 0.7;
      const r = established.radiusM - 2;
      const edge = busAt(
        `E${poll}`,
        { x: r * Math.cos(angle), y: r * Math.sin(angle) },
        { depotId: '1' },
      );
      const yard = step(store, heardAt(tied([edge]), feedNow), feedNow);
      expect(yard?.heldSince).toBe(atMin(0.67));
      expect([yard?.lat, yard?.lng, yard?.radiusM]).toEqual([
        established.lat,
        established.lng,
        established.radiusM,
      ]);
      expect(yard?.inCluster).toBe(11);
    }
  });

  it('keeps the circle on a repeated feed time and recounts it from this snapshot (I4, N5)', () => {
    const store = createYardMemoryStore();
    step(store, heardAt(blob('A', 10, A, 20, { depotId: '1' }), atMin(0)), atMin(0));
    const held = step(store, heardAt(tied(), atMin(1)), atMin(1)) as Yard;
    const entry = store.byDepot.get('1');
    const near = busAt('N', { x: 5, y: 5 }, { depotId: '1' });
    const repeat = step(store, heardAt(tied([near]), atMin(1)), atMin(1));
    expect(repeat).toEqual({ ...held, parked: held.parked + 1, inCluster: held.inCluster + 1 });
    expect(store.byDepot.get('1')).toBe(entry);
  });

  it('lets the rule decide a repeat of a feed time decided as no yard, without writing (N2)', () => {
    const store = createYardMemoryStore();
    expect(step(store, heardAt(tied(), atMin(0)), atMin(0))).toBeUndefined();
    const single = heardAt(blob('A', 10, A, 20, { depotId: '1' }), atMin(0));
    expect(step(store, single, atMin(0))).toEqual(inferYards(single).get('1'));
    expect(store.byDepot.has('1')).toBe(false);
  });

  it('treats an entry older than the hold cap as nothing remembered (M1)', () => {
    const store = createYardMemoryStore();
    step(store, heardAt(blob('A', 10, A, 20, { depotId: '1' }), atHours(0)), atHours(0));
    const later = atHours(YARD_HOLD_MAX_HOURS + 1);
    expect(step(store, heardAt(tied(), later), later)).toBeUndefined();
    expect(store.byDepot.has('1')).toBe(false);
  });

  it('counts only buses heard recently as hold evidence (M9)', () => {
    const store = createYardMemoryStore();
    step(store, heardAt(blob('A', 10, A, 20, { depotId: '1' }), atMin(0)), atMin(0));
    const now = atMin(REPORTING_WINDOW_MIN + 60);
    const dead = heardAt(blob('A', 10, A, 20, { depotId: '1' }), atMin(0));
    const rival = heardAt(blob('R', 10, RIVAL, 20, { depotId: '1' }), now);
    // Ten dead devices still parked in the old yard: the buses have gone.
    expect(step(store, [...dead, ...rival], now)).toBeUndefined();
  });
});
