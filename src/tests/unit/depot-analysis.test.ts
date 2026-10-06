import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DepotBusRow } from '@/models/depotLive';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';
import { fromMetres } from '@/lib/depot/infer/geo';
import { BUS_EXCEPTION_CAP } from '@/lib/depot/exceptions';
import { inferYards } from '@/lib/depot/infer/yard';
import { analyseSnapshot, resetAnalysisForTests } from '@/lib/depot/live/analysis';

vi.mock('@/lib/depot/infer/yard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/depot/infer/yard')>();
  return { ...actual, inferYards: vi.fn(actual.inferYards) };
});

const FEED_NOW = '2026-10-06T08:00:00Z';
const HOME = { lat: 26.85, lng: 80.95 };
const FAR = fromMetres({ x: 20_000, y: 0 }, HOME.lat, HOME.lng);

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

/** Eight buses parked at each of two yards, one depot-2 bus visiting depot 1's yard. */
function twoYardRows(): DepotBusRow[] {
  const home = Array.from({ length: 8 }, (_, i) => row({ registrationNumber: `A${i}` }));
  const far = Array.from({ length: 8 }, (_, i) =>
    row({
      registrationNumber: `B${i}`,
      depotId: '2',
      depotName: 'Barabanki',
      latitude: FAR.lat,
      longitude: FAR.lng,
    }),
  );
  const visitor = row({ registrationNumber: 'B-VISIT', depotId: '2', depotName: 'Barabanki' });
  const homeless = row({ registrationNumber: 'U1', depotId: null, depotName: null });
  return [...home, ...far, visitor, homeless];
}

function view(over: Partial<FleetSnapshotView> = {}): FleetSnapshotView {
  const rows = over.rows ?? twoYardRows();
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

beforeEach(() => {
  resetAnalysisForTests();
  vi.mocked(inferYards).mockClear();
});

describe('analyseSnapshot', () => {
  it('runs once per fetchedAt + source and returns the same object', () => {
    const v = view();
    const first = analyseSnapshot(v);
    expect(analyseSnapshot({ ...v })).toBe(first);
    expect(inferYards).toHaveBeenCalledTimes(1);
  });

  it('recomputes when fetchedAt or source changes', () => {
    const first = analyseSnapshot(view());
    const later = analyseSnapshot(view({ fetchedAt: '2026-10-06T08:00:20.000Z' }));
    expect(later).not.toBe(first);
    const cached = analyseSnapshot(view({ fetchedAt: '2026-10-06T08:00:20.000Z', source: 'cache' }));
    expect(cached).not.toBe(later);
    expect(inferYards).toHaveBeenCalledTimes(3);
  });

  it('classifies every bus once, keyed by registration', () => {
    const a = analyseSnapshot(view());
    expect(a.states.size).toBe(18);
    expect(a.states.get('A0')).toBe('standing');
    expect(a.stateOf(row({ registrationNumber: 'A0' }))).toBe('standing');
    expect(a.feedNow).toBe(FEED_NOW);
  });

  it('groups rows by depot, with homeless buses under unassigned', () => {
    const a = analyseSnapshot(view());
    expect(a.rowsByDepot.get('1')).toHaveLength(8);
    expect(a.rowsByDepot.get('2')).toHaveLength(9);
    expect(a.rowsByDepot.get('unassigned')?.map((r) => r.registrationNumber)).toEqual(['U1']);
    expect(a.depots.map((d) => d.id).sort()).toEqual(['1', '2', 'unassigned']);
    expect(a.scores).toHaveLength(3);
    expect(a.depotsById.get('2')?.fleet).toBe(9);
  });

  it('learns yards and indexes visitors by host depot', () => {
    const a = analyseSnapshot(view());
    expect([...a.yards.keys()]).toEqual(['1', '2']);
    expect(a.locations.get('A0')?.location).toBe('in_yard');
    expect(a.locations.get('B-VISIT')).toMatchObject({ location: 'at_other_yard', otherDepotId: '1' });
    expect(a.visitorsByDepot.get('1')?.map((r) => r.registrationNumber)).toEqual(['B-VISIT', 'U1']);
    expect(a.visitorsByDepot.get('2')).toBeUndefined();
  });

  it('keeps every bus exception per depot while the network list is capped', () => {
    const n = BUS_EXCEPTION_CAP + 50;
    const rows = Array.from({ length: n }, (_, i) =>
      row({ registrationNumber: `R${String(i).padStart(4, '0')}`, mainPowerOn: false }),
    );
    const a = analyseSnapshot(view({ rows }));
    expect(a.report.bus).toHaveLength(BUS_EXCEPTION_CAP);
    expect(a.report.busTotal).toBe(n);
    expect(a.exceptionsByDepot.get('1')?.bus).toHaveLength(n);
  });

  it('files depot exceptions under their depot', () => {
    const a = analyseSnapshot(view());
    for (const [id, group] of a.exceptionsByDepot) {
      for (const e of group.depot) expect(e.depotId).toBe(id);
      for (const e of group.bus) expect(e.depotId ?? 'unassigned').toBe(id);
    }
  });

  it('does not mutate the view rows', () => {
    const rows = Object.freeze(twoYardRows().map((r) => Object.freeze(r)));
    const before = JSON.stringify(rows);
    analyseSnapshot(view({ rows }));
    expect(JSON.stringify(rows)).toBe(before);
  });
});
