// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import type { DepotBusRow } from '@/models/depotLive';
import { resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { buildDepotDetail } from '@/lib/depot/live/depotView';
import { buildDutyBoard } from '@/lib/depot/live/dutyView';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';

const FEED_NOW = '2026-10-06T08:00:00Z';

function row(i: number, depotId: string | null): DepotBusRow {
  return {
    registrationNumber: `UP32A${depotId ?? 'U'}${i}`,
    latitude: 26.85,
    longitude: 80.95,
    speedKmph: 0,
    ignitionOn: false,
    gpsTimestamp: FEED_NOW,
    receivedAt: FEED_NOW,
    depotId,
    depotName: depotId === null ? null : 'Alambagh',
    vehicleStatus: 'stationary',
    tripStatus: 'Stationary',
    routeId: null,
    routeName: `ORD_${i % 3}`,
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
    tamperCode: null,
    emergency: false,
  };
}

const ROWS: readonly DepotBusRow[] = [
  ...Array.from({ length: 8 }, (_, i) => row(i, '1')),
  ...Array.from({ length: 4 }, (_, i) => row(i, null)),
];

function view(over: Partial<FleetSnapshotView> = {}): FleetSnapshotView {
  return {
    rows: ROWS,
    feedNow: FEED_NOW,
    fetchedAt: '2026-10-06T08:00:05.000Z',
    source: 'live',
    stale: false,
    recordCount: ROWS.length,
    ...over,
  };
}

beforeEach(() => resetAnalysisForTests());

describe('the duty board says how many snapshots its yard has been decided on', () => {
  it("carries the depot's count, exactly as the depot's own response does", () => {
    const v = view();
    const board = buildDutyBoard(v, '1');
    expect(board?.yardSnapshotsSeen).toBeTypeOf('number');
    expect(board?.yardSnapshotsSeen).toBe(buildDepotDetail(v, '1')?.yardSnapshotsSeen);
  });

  it('omits it for the saved sample', () => {
    const board = buildDutyBoard(view({ source: 'fixture' }), '1');
    expect(board).not.toBeNull();
    expect(board && 'yardSnapshotsSeen' in board).toBe(false);
  });

  it('omits it for the unassigned group, which the yard memory never decides', () => {
    const board = buildDutyBoard(view(), 'unassigned');
    expect(board === null || !('yardSnapshotsSeen' in board)).toBe(true);
  });
});
