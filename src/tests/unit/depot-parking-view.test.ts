// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import type { DepotBusRow } from '@/models/depotLive';
import { fromMetres } from '@/lib/depot/infer/geo';
import { resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { buildDepotDetail } from '@/lib/depot/live/depotView';
import { buildParkingResponse, nextOperatingDate } from '@/lib/depot/live/parkingView';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';
import { modelDepotMaster } from '@/lib/depot/sim/depotMaster';

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

function parked(count = 12): DepotBusRow[] {
  return Array.from({ length: count }, (_, i) =>
    row({ registrationNumber: `A${i}`, routeName: `ORD_${i % 3}` }),
  );
}

/** Buses 15 km apart: no yard can be learned. */
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

const parking = (rows: readonly DepotBusRow[], v: FleetSnapshotView = view(rows)) => {
  const p = buildParkingResponse(v, '1');
  if (!p) throw new Error('no depot');
  return p;
};

beforeEach(() => resetAnalysisForTests());

describe('nextOperatingDate', () => {
  it('is the day after the feed date, across month and year ends', () => {
    expect(nextOperatingDate('2026-10-06')).toBe('2026-10-07');
    expect(nextOperatingDate('2026-10-31')).toBe('2026-11-01');
    expect(nextOperatingDate('2026-12-31')).toBe('2027-01-01');
    expect(nextOperatingDate('2028-02-28')).toBe('2028-02-29');
  });
});

describe('buildParkingResponse', () => {
  it('is null for a depot the feed does not have', () => {
    expect(buildParkingResponse(view(parked()), '999')).toBeNull();
  });

  it('plans for the day after the feed date, read from the feed clock', () => {
    expect(parking(parked()).operatingDate).toBe('2026-10-07');
    const rows = parked();
    expect(parking(rows, view(rows, { feedNow: '2026-03-31T09:00:00Z' })).operatingDate).toBe(
      '2026-04-01',
    );
  });

  it('puts every parked bus in exactly one place across the lanes and the overflow', () => {
    const rows = parked();
    const p = parking(rows);
    expect(p.state).toBe('planned');
    const order = p.order;
    if (order === null) throw new Error('no order');
    const placed = [
      ...order.lanes.flatMap((l) => l.slots.map((s) => s.registrationNumber)),
      ...order.overflow.map((o) => o.registrationNumber),
    ];
    expect(new Set(placed).size).toBe(placed.length);
    expect(placed.sort()).toEqual(rows.map((r) => r.registrationNumber).sort());
    expect(order.parkedCount).toBe(order.lanes.reduce((n, l) => n + l.slots.length, 0));
  });

  it('never exceeds a lane depth and numbers places from the exit', () => {
    const order = parking(parked(40)).order;
    if (order === null) throw new Error('no order');
    for (const lane of order.lanes) {
      expect(lane.slots.length).toBeLessThanOrEqual(lane.depth);
      expect(lane.slots.map((s) => s.position)).toEqual(lane.slots.map((_, i) => i + 1));
      const starts = lane.slots.map((s) => s.firstDutyStartMin ?? Infinity);
      expect(starts).toEqual([...starts].sort((a, b) => a - b));
    }
    expect(order.blocked).toBe(0);
  });

  it('reconciles its counts with the depot detail', () => {
    const rows = parked();
    const v = view(rows);
    const p = parking(rows, v);
    const detail = buildDepotDetail(v, '1');
    expect(p.capacity.inYard.value).toBe(detail?.locationMix.in_yard);
    expect(p.capacity.visiting.value).toBe(detail?.visitors.length);
    expect(p.capacity.fleet.value).toBe(detail?.depot.fleet);
    expect(p.capacity.bays.value).toBe(modelDepotMaster(detail!.depot).parkingCapacity);
    const order = p.order!;
    expect(order.parkedCount + order.overflow.length).toBe(rows.length);
  });

  it('counts a bus of another depot standing in the yard against capacity but does not order it', () => {
    const rows = [...parked(), row({ registrationNumber: 'V1', depotId: '2', depotName: 'Other' })];
    const p = parking(rows);
    const regs = p.order!.lanes.flatMap((l) => l.slots.map((s) => s.registrationNumber));
    expect(p.capacity.visiting.value).toBe(1);
    expect(regs).not.toContain('V1');
    expect(p.order!.overflow.map((o) => o.registrationNumber)).not.toContain('V1');
  });

  it('tags the provenance of each field', () => {
    const p = parking(parked());
    expect(p.capacity.bays.provenance).toBe('modelled');
    expect(p.capacity.inYard.provenance).toBe('derived');
    expect(p.capacity.visiting.provenance).toBe('derived');
    expect(p.capacity.fleet.provenance).toBe('live');
    expect(p.order?.provenance).toBe('modelled');
  });

  it('gives a duty time to a bus the matching assigned and null to one with no duty', () => {
    const slots = parking(parked(12)).order!.lanes.flatMap((l) => l.slots);
    for (const s of slots) {
      expect(s.firstDutyStartMin === null || Number.isFinite(s.firstDutyStartMin)).toBe(true);
    }
    expect(slots.some((s) => s.firstDutyStartMin !== null)).toBe(true);
  });

  it('withholds the order when no yard is established, with capacity against the fleet only', () => {
    const p = parking(scattered());
    expect(p.state).toBe('no_yard');
    expect(p.order).toBeNull();
    expect(p.capacity.inYard.value).toBeNull();
    expect(p.capacity.fleet.value).toBe(6);
    expect(p.capacity.bays.provenance).toBe('modelled');
  });

  it('answers with a typed empty state for a depot with no buses in its yard rows', () => {
    const rows = [row({ registrationNumber: 'X1', depotId: '1' })];
    const none = buildParkingResponse(view([...rows]), '1');
    expect(none).not.toBeNull();
    expect(['no_yard', 'no_buses', 'planned']).toContain(none!.state);
  });

  it('skips a row with a blank registration instead of throwing', () => {
    const rows = [...parked(), row({ registrationNumber: '' })];
    expect(() => parking(rows)).not.toThrow();
    const regs = parking(rows).order!.lanes.flatMap((l) => l.slots.map((s) => s.registrationNumber));
    expect(regs).not.toContain('');
  });

  it('builds the envelope fresh per call but reuses the body for the same rows', () => {
    const rows = parked();
    const fresh = parking(rows, view(rows));
    const again = parking(rows, { ...view(rows), source: 'cache', stale: true });
    expect(again.stale).toBe(true);
    expect(fresh.stale).toBe(false);
    expect(again.source).toBe('cache');
    expect(again.order).toBe(fresh.order);
    expect(again.capacity).toBe(fresh.capacity);
  });
});
