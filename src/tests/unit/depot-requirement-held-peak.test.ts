// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import type { DepotBusRow } from '@/models/depotLive';
import { fromMetres } from '@/lib/depot/infer/geo';
import { analyseSnapshot, resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { buildDistributionResponse } from '@/lib/depot/live/distributionView';
import { dutyPlanFor } from '@/lib/depot/live/operatingDayView';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';

/*
 * The requirement reads each depot's busiest windowed on-road share so far in
 * the operating date, and the peer median of those. As buses come home in the
 * evening the shares fall, but the modelled day and the transfer plan hold;
 * a bus that really goes off the road still changes what is available.
 */

const DATE = '2026-10-07';
const NEXT_DATE = '2026-10-08';
const HOME = { lat: 26.85, lng: 80.95 };

interface DepotCounts {
  readonly fleet: number;
  readonly out: number;
  readonly offRoad?: number;
}

function row(feedNow: string, depotId: string, i: number, kind: 'out' | 'in' | 'off'): DepotBusRow {
  const out = kind === 'out';
  const p = fromMetres({ x: out ? 8_000 + i * 50 : 0, y: Number(depotId) * 30_000 }, HOME.lat, HOME.lng);
  return {
    registrationNumber: `D${depotId}B${i}`,
    latitude: p.lat,
    longitude: p.lng,
    speedKmph: out ? 30 : 0,
    ignitionOn: out,
    gpsTimestamp: feedNow,
    receivedAt: feedNow,
    depotId,
    depotName: `Depot ${depotId}`,
    vehicleStatus: kind === 'off' ? 'under_maintenance' : out ? 'live' : 'stationary',
    tripStatus: out ? 'Running' : 'Stationary',
    routeId: null,
    routeName: `ORD_${depotId}_${i % 3}`,
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
  };
}

function depotRows(feedNow: string, id: string, counts: DepotCounts): DepotBusRow[] {
  const off = counts.offRoad ?? 0;
  return Array.from({ length: counts.fleet }, (_, i) =>
    row(feedNow, id, i, i < counts.out ? 'out' : i >= counts.fleet - off ? 'off' : 'in'),
  );
}

const BASE: Readonly<Record<string, DepotCounts>> = {
  '1': { fleet: 72, out: 60 },
  '2': { fleet: 40, out: 30 },
  '3': { fleet: 40, out: 25 },
};

function snapshot(
  feedNow: string,
  overrides: Readonly<Record<string, DepotCounts>> = {},
): FleetSnapshotView {
  const counts = { ...BASE, ...overrides };
  const rows = Object.entries(counts).flatMap(([id, c]) => depotRows(feedNow, id, c));
  return { rows, feedNow, fetchedAt: feedNow, source: 'live', stale: false, recordCount: rows.length };
}

interface Reading {
  readonly balances: ReturnType<typeof buildDistributionResponse>['balances'];
  readonly plan: ReturnType<typeof buildDistributionResponse>['plan'];
  readonly duties: number;
  readonly dayPeak: number;
}

function read(view: FleetSnapshotView, depotId = '1', date = DATE): Reading {
  const response = buildDistributionResponse(view);
  const planned = dutyPlanFor(analyseSnapshot(view), depotId, date);
  return {
    balances: response.balances,
    plan: response.plan,
    duties: planned?.duties.length ?? NaN,
    dayPeak: planned?.peakRequirement ?? NaN,
  };
}

const peakOf = (reading: Reading, id: string): number =>
  reading.balances.find((b) => b.depotId === id)?.peakRequirement ?? NaN;

beforeEach(() => resetAnalysisForTests());

describe('the requirement holds the busiest window so far today', () => {
  it('does not shrink when the on-road shares fall, all else equal', () => {
    const first = read(snapshot(`${DATE}T17:00:00Z`));
    const later = read(
      snapshot(`${DATE}T17:45:00Z`, {
        '1': { fleet: 72, out: 40 },
        '2': { fleet: 40, out: 20 },
        '3': { fleet: 40, out: 15 },
      }),
    );
    expect(later.balances).toEqual(first.balances);
    expect(later.plan).toEqual(first.plan);
    expect(later.duties).toBe(first.duties);
    expect(later.dayPeak).toBe(first.dayPeak);
  });

  it('lets a depot whose share rises grow, and lowers no other depot', () => {
    const first = read(snapshot(`${DATE}T08:00:00Z`));
    const later = read(snapshot(`${DATE}T08:05:00Z`, { '1': { fleet: 72, out: 72 } }));
    expect(peakOf(later, '1')).toBeGreaterThan(peakOf(first, '1'));
    for (const id of ['2', '3']) expect(peakOf(later, id)).toBe(peakOf(first, id));
    expect(later.dayPeak).toBe(peakOf(later, '1'));
  });

  it('follows a bus that really goes off the road', () => {
    const first = read(snapshot(`${DATE}T17:00:00Z`));
    const later = read(snapshot(`${DATE}T17:05:00Z`, { '1': { fleet: 72, out: 60, offRoad: 10 } }));
    const before = first.balances.find((b) => b.depotId === '1');
    const after = later.balances.find((b) => b.depotId === '1');
    expect(before?.available).toBe(72);
    expect(after?.available).toBe(62);
    expect(after?.peakRequirement).toBeLessThan(before?.peakRequirement ?? NaN);
    expect(later.dayPeak).toBe(after?.peakRequirement);
  });

  it('starts a new operating date from that date own shares', () => {
    read(snapshot(`${DATE}T09:00:00Z`, { '1': { fleet: 72, out: 72 } }));
    const quiet = { '1': { fleet: 72, out: 40 } };
    const carried = read(snapshot(`${NEXT_DATE}T09:00:00Z`, quiet), '1', NEXT_DATE);
    resetAnalysisForTests();
    const fresh = read(snapshot(`${NEXT_DATE}T09:00:00Z`, quiet), '1', NEXT_DATE);
    expect(carried.balances).toEqual(fresh.balances);
    expect(carried.duties).toBe(fresh.duties);
  });

  it('keeps one depot duty count through an evening of buses coming home', () => {
    const counts = Array.from({ length: 8 }, (_, k) => {
      const feedNow = `${DATE}T18:${String(k * 5).padStart(2, '0')}:00Z`;
      const view = snapshot(feedNow, {
        '1': { fleet: 72, out: 60 - k * 4 },
        '2': { fleet: 40, out: 30 - k * 2 },
        '3': { fleet: 40, out: 25 - k * 2 },
      });
      return read(view).duties;
    });
    expect(new Set(counts).size).toBe(1);
  });

  it('never holds a share from the recorded fixture', () => {
    const busy = snapshot(`${DATE}T09:00:00Z`, { '1': { fleet: 72, out: 72 } });
    read({ ...busy, source: 'fixture' });
    const quiet = { '1': { fleet: 72, out: 40 } };
    const after = read(snapshot(`${DATE}T13:00:00Z`, quiet));
    resetAnalysisForTests();
    expect(after.balances).toEqual(read(snapshot(`${DATE}T13:00:00Z`, quiet)).balances);
  });

  it('gives every request on one snapshot, and both callers, the same shares', () => {
    const view = snapshot(`${DATE}T12:00:00Z`);
    const analysis = analyseSnapshot(view);
    expect(analyseSnapshot({ ...view, source: 'cache' }).requirementShares).toBe(
      analysis.requirementShares,
    );
    for (const balance of buildDistributionResponse(view).balances) {
      expect(dutyPlanFor(analysis, balance.depotId, DATE)?.peakRequirement).toBe(
        balance.peakRequirement,
      );
    }
  });
});
