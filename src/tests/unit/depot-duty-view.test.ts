// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as depotView from '@/lib/depot/live/depotView';
import type { DepotBusRow } from '@/models/depotLive';
import { fromMetres } from '@/lib/depot/infer/geo';
import { resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { buildDutyBoard } from '@/lib/depot/live/dutyView';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';

const FEED_NOW = '2026-10-06T08:00:00Z';
const HOME = { lat: 26.85, lng: 80.95 };

function row(over: Partial<DepotBusRow> = {}): DepotBusRow {
  return {
    registrationNumber: 'UP32A0001',
    latitude: HOME.lat,
    longitude: HOME.lng,
    speedKmph: 0,
    ignitionOn: false,
    gpsTimestamp: FEED_NOW,
    receivedAt: FEED_NOW,
    depotId: '1',
    depotName: 'Alambagh',
    vehicleStatus: 'stationary',
    tripStatus: 'Stationary',
    routeId: null,
    routeName: null,
    routeDescription: null,
    journeyId: null,
    journeyCode: null,
    scheduledStart: null,
    scheduledEnd: null,
    actualStart: null,
    delayMinutes: null,
    odometerRaw: null,
    mainPowerOn: true,
    mainVoltage: null,
    tamperCode: 'C',
    emergency: false,
    ...over,
  };
}

/** Eight buses parked together at HOME (so a yard is learned), each on a named route. */
function parked(count = 8): DepotBusRow[] {
  return Array.from({ length: count }, (_, i) =>
    row({ registrationNumber: `A${i}`, routeName: `ORD_${i % 3}` }),
  );
}

/** A depot whose buses are scattered: no yard can be learned, so none is "in the yard". */
function scattered(count = 6): DepotBusRow[] {
  return Array.from({ length: count }, (_, i) => {
    const p = fromMetres({ x: i * 15_000, y: 0 }, HOME.lat, HOME.lng);
    return row({
      registrationNumber: `S${i}`,
      routeName: 'ORD_1',
      latitude: p.lat,
      longitude: p.lng,
    });
  });
}

function view(
  rows: readonly DepotBusRow[],
  over: Partial<FleetSnapshotView> = {},
): FleetSnapshotView {
  return {
    rows,
    feedNow: FEED_NOW,
    fetchedAt: '2026-10-06T08:00:05.000Z',
    source: 'live',
    stale: false,
    recordCount: rows.length,
    ...over,
  };
}

const board = (rows: readonly DepotBusRow[], v: FleetSnapshotView = view(rows), id = '1') => {
  const b = buildDutyBoard(v, id);
  if (!b) throw new Error('no depot');
  return b;
};

beforeEach(() => resetAnalysisForTests());

describe('buildDutyBoard', () => {
  it('is null for a depot the feed does not have', () => {
    expect(buildDutyBoard(view(parked()), '999')).toBeNull();
  });

  it('reads the operating date from the feed clock, not the wall clock', () => {
    expect(board(parked()).operatingDate).toBe('2026-10-06');
    const rows = parked();
    expect(board(rows, view(rows, { feedNow: '2026-03-02T09:00:00Z' })).operatingDate).toBe(
      '2026-03-02',
    );
  });

  it('reconciles its counts: duties = assigned + unassigned', () => {
    const b = board(parked());
    expect(b.counts.duties).toBe(b.duties.length);
    expect(b.counts.assigned + b.counts.unassigned).toBe(b.counts.duties);
    expect(b.counts.assigned).toBe(b.duties.filter((d) => d.registrationNumber !== null).length);
    expect(b.counts.spare).toBe(b.spareBuses.length);
    expect(b.counts.duties).toBe(b.peakRequirement);
    expect(b.counts.duties).toBeGreaterThan(0);
  });

  it('never puts one bus on two duties, nor a spare bus on a duty', () => {
    const b = board(parked());
    const regs = b.duties.flatMap((d) => (d.registrationNumber ? [d.registrationNumber] : []));
    expect(new Set(regs).size).toBe(regs.length);
    for (const spare of b.spareBuses) expect(regs).not.toContain(spare);
  });

  it('orders duties by start then id', () => {
    const b = board(parked());
    const sorted = [...b.duties].sort((x, y) => x.startMin - y.startMin || (x.id < y.id ? -1 : 1));
    expect(b.duties.map((d) => d.id)).toEqual(sorted.map((d) => d.id));
  });

  it('carries the reason through: a depot with no usable bus leaves every duty without one', () => {
    // No yard, and none of the buses was heard inside the reporting window: with no yard
    // only a standing bus on a recent report is eligible, so every bus is held out.
    const quietSince = new Date(Date.parse(FEED_NOW) - 90 * 60_000).toISOString();
    const b = board(scattered().map((r) => ({ ...r, gpsTimestamp: quietSince })));
    expect(b.eligibilityIgnoredLocation).toBe(true);
    expect(b.counts.assigned).toBe(0);
    expect(b.counts.unassigned).toBe(b.counts.duties);
    expect(b.counts.excluded.notInYard).toBe(6);
    for (const d of b.duties) {
      expect(d.registrationNumber).toBeNull();
      expect(d.blockers).not.toBeNull();
      expect(d.state).toBe(d.blockers && d.blockers.notInYard > 0 ? 'bus_not_in_yard' : 'no_bus');
    }
    expect(b.duties.some((d) => d.state === 'bus_not_in_yard')).toBe(true);
  });

  it('gives an assigned duty a bus, no blockers and the assigned state', () => {
    const b = board(parked());
    for (const d of b.duties.filter((x) => x.registrationNumber !== null)) {
      expect(d.state).toBe('assigned');
      expect(d.blockers).toBeNull();
    }
  });

  it('lists the routes the requirement was too small to cover', () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      row({ registrationNumber: `R${i}`, routeName: `ORD_${String(i).padStart(2, '0')}` }),
    );
    const b = board(rows);
    expect(b.routeCount).toBe(30);
    expect(b.routesWithoutDuty.length).toBe(Math.max(0, 30 - b.peakRequirement));
  });

  it('has no duties for a depot with no routes, and survives hostile text', () => {
    const none = board([row({ registrationNumber: 'X1' })]);
    expect(none.duties).toEqual([]);
    expect(none.counts).toMatchObject({ duties: 0, assigned: 0, unassigned: 0 });
    const odd = board([row({ registrationNumber: '<b>x</b>', routeName: '<script>' })]);
    expect(odd.counts.assigned + odd.counts.unassigned).toBe(odd.counts.duties);
  });

  it('builds the envelope fresh per call but reuses the body for the same rows', () => {
    const rows = parked();
    const fresh = board(rows, view(rows));
    const again = board(rows, { ...view(rows), source: 'cache', stale: true });
    expect(again.stale).toBe(true);
    expect(fresh.stale).toBe(false);
    expect(again.source).toBe('cache');
    expect(again.duties).toBe(fresh.duties);
    expect(again.counts).toBe(fresh.counts);
  });

  it('builds the depot bus list only on a memo miss, never for a repeat or unknown depot', () => {
    const spy = vi.spyOn(depotView, 'buildDepotDetail');
    const rows = parked();
    board(rows);
    expect(spy).toHaveBeenCalledTimes(1);
    board(rows, { ...view(rows), stale: true });
    board(rows, view(rows));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(buildDutyBoard(view(rows), '999')).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe('buildDutyBoard without a yard, and with repeated rows', () => {
  it('matches standing buses heard recently and says location was ignored', () => {
    const b = board(scattered(6));
    expect(b.eligibilityIgnoredLocation).toBe(true);
    expect(b.counts.excluded).toEqual({ notInYard: 0, offRoad: 0, dark: 0 });
    expect(b.counts.assigned + b.counts.spare).toBe(6);
    expect(b.counts.assigned).toBeGreaterThan(0);
  });

  it('says location counted when a yard exists', () => {
    const b = board(parked());
    expect(b.eligibilityIgnoredLocation).toBe(false);
    expect(b.duplicateRowsDropped).toBe(0);
  });

  it('keeps the first row of a repeated registration and reports how many it dropped', () => {
    const repeats = [
      row({ registrationNumber: 'A0', routeName: 'ORD_0' }),
      row({ registrationNumber: ' A1 ', routeName: 'ORD_1' }),
    ];
    const b = board([...parked(), ...repeats]);
    expect(b.duplicateRowsDropped).toBe(2);
    const proposed = b.duties.flatMap((d) => (d.registrationNumber ? [d.registrationNumber] : []));
    expect(new Set([...proposed, ...b.spareBuses]).size).toBe(proposed.length + b.spareBuses.length);
    expect(b.counts.assigned + b.counts.spare).toBe(8);
  });
});
