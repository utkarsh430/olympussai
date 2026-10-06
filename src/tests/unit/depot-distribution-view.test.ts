// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import liveFixture from '@/fixtures/upsrtc-live-sample.json';
import { deriveFeedNow, normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';
import type { DepotBusRow } from '@/models/depotLive';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';
import { fromMetres } from '@/lib/depot/infer/geo';
import { resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { buildDistributionResponse } from '@/lib/depot/live/distributionView';
import { DEFAULT_REQUIREMENT_PARAMS } from '@/lib/depot/sim/config';
import { DEFAULT_REBALANCE_PARAMS } from '@/lib/depot/optimise/config';

const FEED_NOW = '2026-10-06T08:00:00Z';
const fixtureRows = normalizeDepotRows(liveFixture).rows;

function fixtureView(over: Partial<FleetSnapshotView> = {}): FleetSnapshotView {
  return {
    rows: fixtureRows,
    feedNow: deriveFeedNow(fixtureRows),
    fetchedAt: '2026-10-06T08:00:05.000Z',
    source: 'live',
    stale: false,
    recordCount: fixtureRows.length,
    ...over,
  };
}

function expectFinite(value: unknown, path = '$'): void {
  if (typeof value === 'number') {
    expect(Number.isFinite(value), `${path} is not finite`).toBe(true);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => expectFinite(v, `${path}[${i}]`));
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) expectFinite(v, `${path}.${k}`);
  }
}

beforeEach(() => resetAnalysisForTests());

describe('buildDistributionResponse on the sample fixture', () => {
  it('carries the envelope, parameter sets and operating date', () => {
    const view = fixtureView({ stale: true });
    const response = buildDistributionResponse(view);
    expect(response.feedNow).toBe(view.feedNow);
    expect(response.fetchedAt).toBe(view.fetchedAt);
    expect(response.source).toBe('live');
    expect(response.stale).toBe(true);
    expect(response.requirementParams).toEqual(DEFAULT_REQUIREMENT_PARAMS);
    expect(response.rebalanceParams).toEqual(DEFAULT_REBALANCE_PARAMS);
    expect(response.operatingDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(response.balances.length).toBeGreaterThan(0);
    expect(response.plan.transfers).toBeInstanceOf(Array);
  });

  it('reports this request\'s envelope while sharing the body for the same rows', () => {
    const fresh = buildDistributionResponse(fixtureView({ stale: false, source: 'live' }));
    const stale = buildDistributionResponse(fixtureView({ stale: true, source: 'cache' }));
    expect(fresh.stale).toBe(false);
    expect(stale.stale).toBe(true);
    expect(stale.source).toBe('cache');
    expect(stale.balances).toBe(fresh.balances);
    expect(stale.plan).toBe(fresh.plan);
  });

  it('rebuilds the balances when the operating date changes', () => {
    const today = buildDistributionResponse(fixtureView());
    const tomorrow = buildDistributionResponse(fixtureView({ feedNow: '2026-10-07T08:00:00Z' }));
    expect(tomorrow.operatingDate).not.toBe(today.operatingDate);
    expect(tomorrow.balances).not.toBe(today.balances);
    const again = buildDistributionResponse(fixtureView({ feedNow: '2026-10-07T08:00:00Z' }));
    expect(again.balances).toBe(tomorrow.balances);
  });

  it('keeps every balance consistent with its own live anchors', () => {
    for (const b of buildDistributionResponse(fixtureView()).balances) {
      expect(b.available).toBe(b.fleet - b.offRoad);
      expect(b.balance).toBe(b.available - b.required);
    }
  });

  it('holds only finite numbers', () => {
    expectFinite(buildDistributionResponse(fixtureView()));
  });

  it('reconciles the plan totals with the balances', () => {
    const { balances, plan } = buildDistributionResponse(fixtureView());
    const deficits = balances.filter((b) => b.balance < 0);
    const surpluses = balances.filter((b) => b.balance > 0);
    expect(plan.before.depotsInDeficit).toBe(deficits.length);
    expect(plan.before.depotsInSurplus).toBe(surpluses.length);
    expect(plan.before.totalDeficit).toBe(deficits.reduce((s, b) => s - b.balance, 0));
    expect(plan.before.totalSurplus).toBe(surpluses.reduce((s, b) => s + b.balance, 0));
    expect(plan.after.totalDeficit).toBe(plan.before.totalDeficit - plan.coveredDeficit);
    const moved = plan.transfers.reduce((s, t) => s + t.buses, 0);
    expect(plan.coveredDeficit).toBe(moved);
  });

  it('contains no registration number', () => {
    const json = JSON.stringify(buildDistributionResponse(fixtureView()));
    for (const row of fixtureRows) expect(json).not.toContain(row.registrationNumber);
  });
});

const HOME = { lat: 26.85, lng: 80.95 };

function row(over: Partial<DepotBusRow>): DepotBusRow {
  return {
    registrationNumber: 'UP32A0000',
    latitude: HOME.lat,
    longitude: HOME.lng,
    speedKmph: 0,
    ignitionOn: false,
    gpsTimestamp: FEED_NOW,
    receivedAt: FEED_NOW,
    depotId: '1',
    depotName: 'Alambagh',
    vehicleStatus: 'stationary',
    tripStatus: null,
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

/** `count` buses of one depot: `moving` of them in service, the rest parked at its yard. */
function depotRows(
  depotId: string,
  name: string,
  count: number,
  moving: number,
  yard: { lat: number; lng: number },
): DepotBusRow[] {
  return Array.from({ length: count }, (_, i) =>
    row({
      registrationNumber: `UP${depotId}${String(i).padStart(4, '0')}`,
      depotId,
      depotName: name,
      latitude: yard.lat,
      longitude: yard.lng,
      ...(i < moving
        ? { speedKmph: 30, routeName: 'R1', vehicleStatus: 'live', ignitionOn: true }
        : {}),
    }),
  );
}

describe('buildDistributionResponse on a hand-built snapshot', () => {
  it('recommends a transfer from a clear surplus depot to a nearby deficit depot', () => {
    const near = fromMetres({ x: 15_000, y: 0 }, HOME.lat, HOME.lng);
    const rows = [
      ...depotRows('1', 'Alambagh', 40, 0, HOME),
      ...depotRows('2', 'Kaiserbagh', 40, 40, near),
      ...depotRows('3', 'Charbagh', 40, 20, HOME),
    ];
    const view: FleetSnapshotView = {
      rows,
      feedNow: FEED_NOW,
      fetchedAt: '2026-10-06T08:00:05.000Z',
      source: 'live',
      stale: false,
      recordCount: rows.length,
    };
    const { balances, plan } = buildDistributionResponse(view);
    const byId = new Map(balances.map((b) => [b.depotId, b]));
    expect((byId.get('1')?.balance ?? 0) > 0).toBe(true);
    expect((byId.get('2')?.balance ?? 0) < 0).toBe(true);
    expect(plan.transfers.some((t) => t.fromDepotId === '1' && t.toDepotId === '2')).toBe(true);
  });
});
