// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import type { DepotBusRow } from '@/models/depotLive';
import { fromMetres } from '@/lib/depot/infer/geo';
import { analyseSnapshot, resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { buildDutyBoard } from '@/lib/depot/live/dutyView';
import { dutyPlanFor, laterDayPlanFor } from '@/lib/depot/live/operatingDayView';
import { buildParkingResponse } from '@/lib/depot/live/parkingView';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';

/*
 * Ruling S62 (N7): until the first duty of the feed's own date has started, the
 * day has not begun. Today's one shared plan then matches buses as they stand in
 * the yard (as a later-day plan does), and the night parking order plans the
 * feed's OWN date from that same plan.
 */

const DATE = '2026-10-07';
const HOME = { lat: 26.85, lng: 80.95 };

function row(feedNow: string, over: Partial<DepotBusRow>): DepotBusRow {
  return {
    registrationNumber: 'UP32A0001',
    latitude: HOME.lat,
    longitude: HOME.lng,
    speedKmph: 0,
    ignitionOn: false,
    gpsTimestamp: feedNow,
    receivedAt: feedNow,
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

/** The review's depot: 12 buses standing in the yard, 60 out in service far from it. */
function depotRows(feedNow: string, withRoutes = true): DepotBusRow[] {
  const yard = Array.from({ length: 12 }, (_, i) =>
    row(feedNow, { registrationNumber: `A${i}`, routeName: withRoutes ? `ORD_${i % 3}` : null }),
  );
  const out = Array.from({ length: 60 }, (_, i) => {
    const p = fromMetres({ x: 8_000 + i * 50, y: 0 }, HOME.lat, HOME.lng);
    return row(feedNow, {
      registrationNumber: `R${i}`,
      routeName: withRoutes ? `ORD_${i % 3}` : null,
      latitude: p.lat,
      longitude: p.lng,
      speedKmph: 30,
      vehicleStatus: 'live',
      tripStatus: 'Running',
    });
  });
  return [...yard, ...out];
}

function view(rows: readonly DepotBusRow[], feedNow: string | null): FleetSnapshotView {
  return {
    rows,
    feedNow,
    fetchedAt: `${DATE}T00:05:05.000Z`,
    source: 'live',
    stale: false,
    recordCount: rows.length,
  };
}

const at = (clock: string): string => `${DATE}T${clock}Z`;
const YARD = new Set(Array.from({ length: 12 }, (_, i) => `A${i}`));
const pad2 = (n: number): string => String(n).padStart(2, '0');
const clockOf = (minute: number, second: number): string =>
  `${pad2(Math.floor(minute / 60))}:${pad2(minute % 60)}:${pad2(second)}`;

/** The depot's first duty start on DATE; duties do not depend on the feed time. */
function firstDutyStart(): number {
  const plan = dutyPlanFor(analyseSnapshot(view(depotRows(at('10:00:00')), at('10:00:00'))), '1', DATE);
  resetAnalysisForTests();
  return Math.min(...(plan?.duties ?? []).map((d) => d.startMin));
}

function boardAndParking(feedNow: string | null, rows: readonly DepotBusRow[]) {
  const v = view(rows, feedNow);
  const board = buildDutyBoard(v, '1');
  const parking = buildParkingResponse(v, '1');
  if (!board || !parking) throw new Error('no depot');
  return { board, parking };
}

beforeEach(() => resetAnalysisForTests());

describe('before the first duty of the feed date (S62)', () => {
  it('at 00:05 gives the yard buses the duties and parks them for the same date', () => {
    const { board, parking } = boardAndParking(at('00:05:00'), depotRows(at('00:05:00')));
    expect(board.operatingDate).toBe(DATE);
    expect(board.planMode).toBe('before_first_duty');
    const matched = board.duties.filter((d) => d.registrationNumber !== null);
    expect(new Set(matched.map((d) => d.registrationNumber))).toEqual(YARD);
    expect(matched.every((d) => d.busStanding === 'in_yard')).toBe(true);
    // The parking order is for the feed's own date, read off the same shared plan.
    expect(parking.operatingDate).toBe(board.operatingDate);
    const slots = parking.order!.lanes.flatMap((l) => l.slots);
    expect(slots).toHaveLength(12);
    for (const s of slots) {
      const own = board.duties.filter((d) => d.registrationNumber === s.registrationNumber);
      expect(own.length).toBeGreaterThan(0);
      expect(s.firstDutyStartMin).toBe(Math.min(...own.map((d) => d.startMin)));
    }
  });

  it('builds no separate plan for the day after while the day has not begun', () => {
    const v = view(depotRows(at('00:05:00')), at('00:05:00'));
    const shared = dutyPlanFor(analyseSnapshot(v), '1', DATE);
    buildParkingResponse(v, '1');
    expect(dutyPlanFor(analyseSnapshot(v), '1', DATE)).toBe(shared);
    expect(shared?.mode).toBe('before_first_duty');
  });

  it('switches at the first duty start: one second before is before, at it is as of the feed', () => {
    const first = firstDutyStart();
    expect(first).toBeGreaterThan(0);
    const before = at(clockOf(first - 1, 59));
    const b = boardAndParking(before, depotRows(before));
    expect(b.board.planMode).toBe('before_first_duty');
    expect(b.parking.operatingDate).toBe(DATE);
    resetAnalysisForTests();
    const onTime = at(clockOf(first, 0));
    const a = boardAndParking(onTime, depotRows(onTime));
    expect(a.board.planMode).toBe('as_of_feed_time');
    expect(a.parking.operatingDate).toBe('2026-10-08');
    // From then on the buses out working are preferred, as today.
    expect(a.board.duties.filter((d) => d.busStanding === 'on_road').length).toBeGreaterThan(0);
  });

  it('a depot with no duties is as of the feed time: no first duty is waited for', () => {
    const { board, parking } = boardAndParking(at('00:05:00'), depotRows(at('00:05:00'), false));
    expect(board.duties).toHaveLength(0);
    expect(board.planMode).toBe('as_of_feed_time');
    expect(parking.operatingDate).toBe('2026-10-08');
  });

  it('a feed with no clock is as of the feed time: it cannot be placed before a duty', () => {
    const { board, parking } = boardAndParking(null, depotRows(at('00:05:00')));
    expect(board.planMode).toBe('as_of_feed_time');
    expect(board.recencyNotJudged).toBe(true);
    // The date comes from the fetch time read in Indian time (05:35 on DATE).
    expect(board.operatingDate).toBe(DATE);
    expect(parking.operatingDate).toBe('2026-10-08');
  });

  it('names its mode on every plan; the later-day plan is in later_day mode', () => {
    const v = view(depotRows(at('10:00:00')), at('10:00:00'));
    const analysis = analyseSnapshot(v);
    expect(dutyPlanFor(analysis, '1', DATE)?.mode).toBe('as_of_feed_time');
    expect(laterDayPlanFor(analysis, '1', '2026-10-08')?.mode).toBe('later_day');
  });
});
