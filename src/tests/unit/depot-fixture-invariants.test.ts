import { describe, it, expect, expectTypeOf, beforeEach } from 'vitest';
import liveFixture from '@/fixtures/upsrtc-live-sample.json';
import { deriveFeedNow, normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';
import type { DepotBusRow } from '@/models/depotLive';
import type {
  DepotDetailResponse,
  DepotExceptionsResponse,
  DepotNetworkResponse,
} from '@/lib/depot/api';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';
import { analyseSnapshot, resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { buildNetworkResponse } from '@/lib/depot/live/networkView';
import { buildExceptionsResponse } from '@/lib/depot/live/exceptionView';
import { buildDepotDetail } from '@/lib/depot/live/depotView';

/**
 * End-to-end invariants on the committed sample feed: the numbers every depot
 * screen rests on must add up, be finite, and stay small enough to poll.
 */

const MAX_NETWORK_BYTES = 120 * 1024;
const rows = normalizeDepotRows(liveFixture).rows;

function fixtureView(
  feedRows: readonly DepotBusRow[] = rows,
  fetchedAt = 'fixture-1',
): FleetSnapshotView {
  return {
    rows: feedRows,
    feedNow: deriveFeedNow(feedRows),
    fetchedAt,
    source: 'fixture',
    stale: true,
    recordCount: feedRows.length,
  };
}

/** Every number anywhere in the value, with its path, so a failure names the culprit. */
function numbersIn(value: unknown, path = '$'): { path: string; value: number }[] {
  if (typeof value === 'number') return [{ path, value }];
  if (Array.isArray(value)) return value.flatMap((item, i) => numbersIn(item, `${path}[${i}]`));
  if (value instanceof Map) return numbersIn(Object.fromEntries(value), path);
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => numbersIn(item, `${path}.${key}`));
  }
  return [];
}

/** Lengths of every array in the value. */
function arrayLengths(value: unknown): number[] {
  if (Array.isArray(value)) return [value.length, ...value.flatMap(arrayLengths)];
  if (value !== null && typeof value === 'object')
    return Object.values(value).flatMap(arrayLengths);
  return [];
}

const sum = (values: Readonly<Record<string, number>>): number =>
  Object.values(values).reduce((total, n) => total + n, 0);

beforeEach(() => resetAnalysisForTests());

describe('depot fixture invariants', () => {
  const view = fixtureView();
  const network = (): DepotNetworkResponse => buildNetworkResponse(view);
  const exceptions = (): DepotExceptionsResponse => buildExceptionsResponse(view);
  const details = (): DepotDetailResponse[] =>
    network().depots.map((d) => {
      const detail = buildDepotDetail(view, d.id);
      if (!detail) throw new Error(`depot ${d.id} has no detail`);
      return detail;
    });

  it('has 113 depot buckets whose fleets sum to 400', () => {
    expect(rows).toHaveLength(400);
    expect(network().depots).toHaveLength(113);
    expect(network().depots.reduce((total, d) => total + d.fleet, 0)).toBe(400);
  });

  it("sums each depot's states and statuses to its fleet", () => {
    for (const depot of network().depots) {
      expect(sum({ ...depot.states }), `states of ${depot.id}`).toBe(depot.fleet);
      expect(sum({ ...depot.status }), `status of ${depot.id}`).toBe(depot.fleet);
    }
  });

  it('sums each depot detail to its fleet', () => {
    for (const detail of details()) {
      expect(detail.buses).toHaveLength(detail.depot.fleet);
      expect(sum(detail.locationMix)).toBe(detail.depot.fleet);
    }
  });

  it('contains only finite numbers in every response and the analysis', () => {
    const everything = [network(), exceptions(), ...details(), analyseSnapshot(view).scores];
    const bad = everything.flatMap((r) => numbersIn(r)).filter((n) => !Number.isFinite(n.value));
    expect(bad).toEqual([]);
  });

  it('matches the contract types', () => {
    expectTypeOf(network()).toEqualTypeOf<DepotNetworkResponse>();
    expectTypeOf(exceptions()).toEqualTypeOf<DepotExceptionsResponse>();
    expectTypeOf(buildDepotDetail(view, '1')).toEqualTypeOf<DepotDetailResponse | null>();
  });

  it('keeps the network response small and free of bus rows', () => {
    const json = JSON.stringify(network());
    expect(json.length).toBeLessThan(MAX_NETWORK_BYTES);
    const named = rows.filter((r) => json.includes(`"${r.registrationNumber}"`));
    expect(named).toEqual([]);
  });

  it("never sends the whole fleet's rows in one response", () => {
    for (const response of [network(), exceptions(), ...details()]) {
      expect(Math.max(0, ...arrayLengths(response))).toBeLessThan(rows.length);
    }
  });

  it('gives identical exceptions on the same feed in another order', () => {
    const first = analyseSnapshot(view).report;
    const reversed = analyseSnapshot(fixtureView([...rows].reverse(), 'fixture-2')).report;
    expect(reversed).toEqual(first);
  });
});
