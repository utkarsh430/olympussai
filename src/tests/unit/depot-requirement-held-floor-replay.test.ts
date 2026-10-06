// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import type { DepotBusRow } from '@/models/depotLive';
import { loadFleetFixture } from '@/lib/upsrtc/fleetFixture';
import { normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';
import { analyseSnapshot, resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { buildDistributionResponse } from '@/lib/depot/live/distributionView';
import { dutyPlanFor } from '@/lib/depot/live/operatingDayView';
import { defaultPeakRequirementStore } from '@/lib/depot/live/peakRequirementHold';
import type { DepotBalance } from '@/lib/depot/optimise/types';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';
import { DEFAULT_REQUIREMENT_PARAMS } from '@/lib/depot/sim/config';
import { modelBalances, spareTargetFor } from '@/lib/depot/sim/requirement';

/*
 * On the recorded full fleet, the duty total of a depot's modelled day moved by
 * one between snapshots a minute apart: dropping one of the depot's rows lowers
 * what is available by one, and a peer whose share rises past the median lowers
 * the depot's utilisation; either moves round(available x utilisation). The
 * peak is now floored by the highest computed for the depot earlier in the
 * date, so the total holds; only a real loss of buses below it lowers it.
 * Views are marked `live`: the holders ignore the recorded fixture's source.
 */

const ROWS = normalizeDepotRows(loadFleetFixture()).rows;
const DATE = '2026-10-06';
const NEXT_DATE = '2026-10-07';
const at = (minute: number, date = DATE): string =>
  `${date}T08:${String(minute).padStart(2, '0')}:00.000Z`;

function viewOf(rows: readonly DepotBusRow[], feedNow: string, live = true): FleetSnapshotView {
  return {
    rows: [...rows],
    feedNow,
    fetchedAt: feedNow,
    source: live ? 'live' : 'fixture',
    stale: false,
    recordCount: rows.length,
  };
}

interface Reading {
  readonly duties: number;
  readonly held: DepotBalance;
  /** The peak as computed for this snapshot alone, before any floor. */
  readonly computed: number;
}

function balanceOf(list: readonly DepotBalance[], id: string): DepotBalance {
  const found = list.find((b) => b.depotId === id);
  if (!found) throw new Error(`no balance for depot ${id}`);
  return found;
}

function read(view: FleetSnapshotView, id: string, date = DATE): Reading {
  const analysis = analyseSnapshot(view);
  const unfloored = modelBalances(
    analysis.depots,
    analysis.yards,
    date,
    DEFAULT_REQUIREMENT_PARAMS,
    analysis.requirementShares,
  );
  return {
    duties: dutyPlanFor(analysis, id, date)?.duties.length ?? Number.NaN,
    held: balanceOf(buildDistributionResponse(view).balances, id),
    computed: balanceOf(unfloored, id).peakRequirement,
  };
}

const ranked = (() => {
  resetAnalysisForTests();
  return [...buildDistributionResponse(viewOf(ROWS, at(0))).balances]
    .filter((b) => b.kind === 'depot')
    .sort((a, b) => b.peakRequirement - a.peakRequirement || a.depotId.localeCompare(b.depotId));
})();

/** A bus of the depot on the road: losing its row lowers what is available, not the held share. */
function onRoadRowOf(id: string): DepotBusRow | undefined {
  resetAnalysisForTests();
  const { stateOf } = analyseSnapshot(viewOf(ROWS, at(0)));
  return ROWS.find(
    (r) => r.depotId === id && (stateOf(r) === 'in_service' || stateOf(r) === 'on_road'),
  );
}

/**
 * Among the busiest depots, the first whose computed peak falls when the feed
 * drops one of its on-road rows (most do: a depot at a rounding boundary may
 * need a second row), with that row.
 */
const { FOCUS, victim } = (() => {
  for (const { depotId } of ranked.slice(0, 10)) {
    const row = onRoadRowOf(depotId);
    if (row === undefined) continue;
    const before = read(viewOf(ROWS, at(0)), depotId).computed;
    if (read(viewOf(ROWS.filter((r) => r !== row), at(1)), depotId).computed < before) {
      return { FOCUS: depotId, victim: row };
    }
  }
  return { FOCUS: '', victim: undefined };
})();
const ownRows = ROWS.filter((r) => r.depotId === FOCUS);
const withoutOneRow = ROWS.filter((r) => r !== victim);

/** Every bus of `count` other depots (not the focus) running at the feed time. */
function liftOthers(rows: readonly DepotBusRow[], count: number, feedNow: string): DepotBusRow[] {
  const lifted = new Set(ranked.slice(5, 5 + count).map((b) => b.depotId));
  return rows.map((r) =>
    r.depotId !== null && lifted.has(r.depotId) && r.vehicleStatus !== 'under_maintenance'
      ? {
          ...r,
          speedKmph: 35,
          ignitionOn: true,
          gpsTimestamp: feedNow,
          receivedAt: feedNow,
          vehicleStatus: 'live' as const,
          tripStatus: 'Running',
        }
      : r,
  );
}

function expectConsistent(b: DepotBalance): void {
  expect(b.available).toBe(b.fleet - b.offRoad);
  const ratio = DEFAULT_REQUIREMENT_PARAMS.spareRatio;
  expect(b.spareTarget).toBe(spareTargetFor(b.peakRequirement, ratio));
  expect(b.required).toBe(b.peakRequirement + b.spareTarget);
  expect(b.balance).toBe(b.available - b.required);
}

beforeEach(() => resetAnalysisForTests());

describe('the duty total holds through the inputs that moved it', () => {
  it('is unchanged when the feed drops one of the depot rows', () => {
    expect(victim).toBeDefined();
    const first = read(viewOf(ROWS, at(0)), FOCUS);
    const second = read(viewOf(withoutOneRow, at(1)), FOCUS);
    expect(second.held.available).toBe(first.held.available - 1);
    expect(second.computed).toBeLessThan(first.computed);
    expect(second.duties).toBe(first.duties);
    expect(second.held.peakRequirement).toBe(first.held.peakRequirement);
    expectConsistent(second.held);
  });

  it("is unchanged when other depots' shares rise past the median", () => {
    const first = read(viewOf(ROWS, at(0)), FOCUS);
    const second = read(viewOf(liftOthers(ROWS, 15, at(1)), at(1)), FOCUS);
    expect(second.held.available).toBe(first.held.available);
    expect(second.computed).toBeLessThan(first.computed);
    expect(second.duties).toBe(first.duties);
  });

  it('only holds or rises over eight snapshots of one date with both moving', () => {
    const readings = Array.from({ length: 8 }, (_, k) => {
      const base = k % 2 === 1 ? withoutOneRow : ROWS;
      const lifted = k < 3 ? 0 : k < 5 ? 5 : 15;
      return read(viewOf(liftOthers(base, lifted, at(k)), at(k)), FOCUS);
    });
    const computed = readings.map((r) => r.computed);
    expect(Math.min(...computed)).toBeLessThan(computed[0] ?? Number.NaN);
    readings.slice(1).forEach((r, k) => {
      expect(r.duties).toBeGreaterThanOrEqual(readings[k]?.duties ?? Number.NaN);
      expect(r.duties).toBe(r.held.peakRequirement);
    });
  });

  it('caps the peak at what is available after a large real loss, and stays consistent', () => {
    const first = read(viewOf(ROWS, at(0)), FOCUS);
    const lost = new Set(ownRows.slice(0, 60).map((r) => r.registrationNumber));
    const broken = ROWS.map((r) =>
      lost.has(r.registrationNumber) ? { ...r, vehicleStatus: 'under_maintenance' as const } : r,
    );
    const second = read(viewOf(broken, at(1)), FOCUS);
    expect(second.held.available).toBeLessThan(first.held.peakRequirement);
    expect(second.held.peakRequirement).toBe(second.held.available);
    expect(second.duties).toBe(second.held.peakRequirement);
    expectConsistent(second.held);
  });
});

describe('the held peaks start afresh and never come from the fixture', () => {
  it('starts a new operating date from that date alone', () => {
    read(viewOf(ROWS, at(0)), FOCUS);
    const next = viewOf(withoutOneRow, at(0, NEXT_DATE));
    const carried = read(next, FOCUS, NEXT_DATE);
    resetAnalysisForTests();
    const fresh = read(viewOf(withoutOneRow, at(0, NEXT_DATE)), FOCUS, NEXT_DATE);
    expect(carried).toEqual(fresh);
  });

  it('neither reads nor writes the holder for the recorded fixture', () => {
    read(viewOf(ROWS, at(0), false), FOCUS);
    expect(defaultPeakRequirementStore().operatingDate).toBeNull();
    const after = read(viewOf(withoutOneRow, at(1)), FOCUS);
    resetAnalysisForTests();
    expect(after).toEqual(read(viewOf(withoutOneRow, at(1)), FOCUS));
  });

  it('gives the operating day and the distribution view the same floored peaks', () => {
    read(viewOf(ROWS, at(0)), FOCUS);
    const view = viewOf(withoutOneRow, at(1));
    const analysis = analyseSnapshot(view);
    for (const balance of buildDistributionResponse(view).balances) {
      expect(dutyPlanFor(analysis, balance.depotId, DATE)?.peakRequirement).toBe(
        balance.peakRequirement,
      );
    }
  });
});
