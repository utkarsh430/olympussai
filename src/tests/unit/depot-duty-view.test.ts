// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as depotView from '@/lib/depot/live/depotView';
import type { DepotBusRow } from '@/models/depotLive';
import { fromMetres } from '@/lib/depot/infer/geo';
import { analyseSnapshot, resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { dutyPlanFor } from '@/lib/depot/live/operatingDayView';
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

  it('counts the held-out buses of every class on each unassigned duty (S55, N6)', () => {
    const quietSince = new Date(Date.parse(FEED_NOW) - 90 * 60_000).toISOString();
    const rows = [
      ...scattered(),
      row({ registrationNumber: 'E1', routeName: 'EXP_1', latitude: 27.5 }),
      row({ registrationNumber: 'E2', routeName: 'EXP_1', latitude: 27.6 }),
    ].map((r) => ({ ...r, gpsTimestamp: quietSince }));
    const b = board(rows);
    expect(b.counts.excluded.notHeard).toBe(8);
    for (const d of b.duties) expect(d.blockers).toEqual(b.counts.excluded);
  });

  it('carries the class of the bus on each assigned duty, so a mismatch can be shown (m6)', () => {
    const rows = [...parked(), row({ registrationNumber: 'E1', routeName: 'EXP_1' })];
    const b = board(rows);
    const plan = dutyPlanFor(analyseSnapshot(view(rows)), '1', b.operatingDate);
    // Without a plan both sides below would be undefined and the loop would prove nothing.
    expect(plan).not.toBeNull();
    // The express bus the test is named for is on a duty, carrying its own class.
    expect(b.duties.some((d) => d.busClass === 'express')).toBe(true);
    for (const d of b.duties) {
      const expected = d.registrationNumber === null ? null : plan?.fleet.get(d.registrationNumber)?.serviceClass;
      expect(d.busClass).toBe(expected);
    }
  });

  it('hands out frozen copies of the shared plan’s lists, never the lists themselves (m4)', () => {
    const rows = parked(12);
    const b = board(rows);
    const plan = dutyPlanFor(analyseSnapshot(view(rows)), '1', b.operatingDate);
    expect(b.spareBuses).not.toBe(plan?.plan.spareBuses);
    expect(b.routesWithoutDuty).not.toBe(plan?.routesWithoutDuty);
    expect(Object.isFrozen(b.spareBuses)).toBe(true);
    expect(Object.isFrozen(b.routesWithoutDuty)).toBe(true);
  });

  it('carries the reason through: a depot with no usable bus leaves every duty without one', () => {
    // No yard, and none of the buses was heard inside the reporting window: every bus is
    // held out as not heard recently (S55), and no duty blames the yard.
    const quietSince = new Date(Date.parse(FEED_NOW) - 90 * 60_000).toISOString();
    const b = board(scattered().map((r) => ({ ...r, gpsTimestamp: quietSince })));
    expect(b.eligibilityIgnoredLocation).toBe(true);
    expect(b.counts.assigned).toBe(0);
    expect(b.counts.unassigned).toBe(b.counts.duties);
    expect(b.counts.excluded.notHeard).toBe(6);
    expect(b.counts.excluded.notInYard).toBe(0);
    for (const d of b.duties) {
      expect(d.registrationNumber).toBeNull();
      expect(d.blockers?.notHeard).toBe(6);
      expect(d.state).toBe('no_bus');
    }
  });

  it('gives an assigned duty a bus, no blockers and the assigned state', () => {
    const b = board(parked());
    const assigned = b.duties.filter((x) => x.registrationNumber !== null);
    expect(assigned.length).toBeGreaterThan(0);
    for (const d of assigned) {
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
    // No full depot detail is built for the board: only the bus list, once (review M4).
    const detail = vi.spyOn(depotView, 'buildDepotDetail');
    const spy = vi.spyOn(depotView, 'depotBusViews');
    const rows = parked();
    board(rows);
    expect(spy).toHaveBeenCalledTimes(1);
    board(rows, { ...view(rows), stale: true });
    board(rows, view(rows));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(buildDutyBoard(view(rows), '999')).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(detail).not.toHaveBeenCalled();
    spy.mockRestore();
    detail.mockRestore();
  });
});

describe('buildDutyBoard without a yard, and with repeated rows', () => {
  it('matches standing buses heard recently and says location was ignored', () => {
    const b = board(scattered(6));
    expect(b.eligibilityIgnoredLocation).toBe(true);
    expect(b.counts.excluded).toEqual({ notInYard: 0, notHeard: 0, offRoad: 0, dark: 0 });
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
