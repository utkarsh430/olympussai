// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { loadFleetFixture } from '@/lib/upsrtc/fleetFixture';
import { normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';
import type { DepotBusRow } from '@/models/depotLive';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';
import { EXCEPTION_BASIS } from '@/lib/depot/exceptions/config';
import { analyseSnapshot, resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { buildExceptionsResponse } from '@/lib/depot/live/exceptionView';

/*
 * A windowed depot exception carries the number of snapshots its depot was
 * scored on, so a page words one on a depot new to the window by its own
 * samples, not by the network's widest window. Nit: the shared basis table
 * placed in every memoised body is frozen.
 */

// The full fleet: the small sample has too few depots for a peer comparison to fire.
const rows = normalizeDepotRows(loadFleetFixture()).rows;
const F0 = '2026-10-06T08:00:00.000Z';
const F1 = '2026-10-06T08:01:00.000Z';

function viewOf(r: readonly DepotBusRow[], feedNow: string): FleetSnapshotView {
  return { rows: r, feedNow, fetchedAt: feedNow, source: 'live', stale: false, recordCount: r.length };
}

describe('per-depot samples on depot exceptions', () => {
  beforeEach(() => resetAnalysisForTests());

  it("states each windowed exception's own depot samples on the exceptions response", () => {
    const probe = analyseSnapshot(viewOf(rows, F0));
    const newcomer = probe.report.depot.find((e) => e.basis === 'window')?.depotId;
    expect(newcomer).toBeDefined();
    resetAnalysisForTests();
    // The newcomer depot is missing from the first snapshot, so it has one sample at F1.
    analyseSnapshot(viewOf(rows.filter((r) => r.depotId !== newcomer), F0));
    const later = viewOf(rows, F1);
    const analysis = analyseSnapshot(later);
    const response = buildExceptionsResponse(later);
    const windowed = response.report.depot.filter((e) => e.basis === 'window');
    expect(windowed.length).toBeGreaterThan(0);
    for (const e of windowed) {
      expect(e.samples).toBe(analysis.scoresById.get(e.depotId)?.samples);
    }
    expect(new Set(windowed.map((e) => e.samples))).toContain(2);
    for (const e of windowed.filter((x) => x.depotId === newcomer)) expect(e.samples).toBe(1);
    for (const e of response.report.depot.filter((x) => x.basis === 'feed_time')) {
      expect(e.samples).toBeUndefined();
    }
  });

  it('freezes the shared exception basis table', () => {
    expect(Object.isFrozen(EXCEPTION_BASIS)).toBe(true);
  });
});
