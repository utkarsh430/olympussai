import { beforeEach, describe, expect, it } from 'vitest';
import type { DepotBusRow } from '@/models/depotLive';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';
import { inferYards } from '@/lib/depot/infer/yard';
import {
  applyYardContinuity,
  createYardMemoryStore,
  yardSnapshotsSeen,
} from '@/lib/depot/infer/yardMemory';
import { YARD_HOLD_MAX_HOURS } from '@/lib/depot/infer/yardContinuity';
import { resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { buildNetworkResponse } from '@/lib/depot/live/networkView';
import { buildDepotDetail } from '@/lib/depot/live/depotView';
import { blob, type XY } from './depot-yard.fixtures';

/*
 * N10: a yard missing because this process has just started must be told
 * apart from a yard the evidence refuses. The yard memory counts, per depot,
 * the feed times it has decided the depot's yard on (since the process started,
 * the memory's last epoch, or the depot's last absence longer than the hold
 * cap); the network response carries the count as `yardSnapshotsSeen`.
 */

const T0 = Date.parse('2026-10-06T06:00:00.000Z');
const atMin = (minutes: number): string => new Date(T0 + minutes * 60_000).toISOString();
const A: XY = { x: 0, y: 0 };

function rowsAt(feedNow: string, depotId = '1'): DepotBusRow[] {
  return blob(`D${depotId}-`, 12, A, 20, { depotId }).map((r) => ({ ...r, gpsTimestamp: feedNow }));
}

type Store = ReturnType<typeof createYardMemoryStore>;
function step(store: Store, feedNow: string, fixture = false): number {
  const rows = rowsAt(feedNow);
  applyYardContinuity(store, rows, inferYards(rows), feedNow, { fixture });
  return yardSnapshotsSeen(store, '1');
}

describe('yard memory: snapshots seen per depot (N10)', () => {
  it('counts each newer feed time once, and nothing else', () => {
    const store = createYardMemoryStore();
    expect(yardSnapshotsSeen(store, '1')).toBe(0);
    expect(step(store, atMin(0))).toBe(1);
    expect(step(store, atMin(1))).toBe(2);
    expect(step(store, atMin(1))).toBe(2);
    expect(step(store, atMin(0))).toBe(2);
    expect(step(store, atMin(-60))).toBe(2);
    expect(step(store, atMin(2), true)).toBe(2);
    expect(yardSnapshotsSeen(store, 'other')).toBe(0);
  });

  it('starts again on a new epoch and after an absence longer than the hold cap', () => {
    const store = createYardMemoryStore();
    for (const at of [300, 301, 302]) step(store, atMin(at));
    for (const at of [0, 1]) expect(step(store, atMin(at))).toBe(3);
    expect(step(store, atMin(2))).toBe(1);
    const later = atMin(2 + YARD_HOLD_MAX_HOURS * 60 + 1);
    const otherRows = rowsAt(later, '2');
    applyYardContinuity(store, otherRows, inferYards(otherRows), later);
    expect(yardSnapshotsSeen(store, '1')).toBe(0);
  });
});

describe('network response: yardSnapshotsSeen (N10)', () => {
  beforeEach(() => resetAnalysisForTests());

  const viewAt = (minute: number, source: FleetSnapshotView['source'] = 'live') => ({
    rows: [...rowsAt(atMin(minute)), ...rowsAt(atMin(minute), '2')],
    feedNow: atMin(minute),
    fetchedAt: atMin(minute),
    source,
    stale: false,
    recordCount: 24,
  });

  it('says how many snapshots this process has decided each depot on', () => {
    expect(buildNetworkResponse(viewAt(0)).yardSnapshotsSeen).toEqual({ '1': 1, '2': 1 });
    expect(buildNetworkResponse(viewAt(1)).yardSnapshotsSeen).toEqual({ '1': 2, '2': 2 });
  });

  it('says 0 for the fixture, which never uses the memory', () => {
    expect(buildNetworkResponse(viewAt(0, 'fixture')).yardSnapshotsSeen).toEqual({ '1': 0, '2': 0 });
  });

  it('gives a depot page the same count for its own depot', () => {
    // The cockpit and the yard page read the depot response, not the network one: they
    // need the count to tell "the server has only just started" from "no yard is found".
    expect(buildDepotDetail(viewAt(0), '1')?.yardSnapshotsSeen).toBe(1);
    expect(buildDepotDetail(viewAt(1), '1')?.yardSnapshotsSeen).toBe(2);
    expect(buildDepotDetail(viewAt(1), '2')?.yardSnapshotsSeen).toBe(2);
  });
});
