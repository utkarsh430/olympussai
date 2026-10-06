// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { loadFleetFixture } from '@/lib/upsrtc/fleetFixture';
import { normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';
import type { DepotBusRow } from '@/models/depotLive';
import type { FleetSnapshotView } from '@/lib/depot/repositories/types';
import {
  analyseSnapshot,
  resetAnalysisForTests,
  type SnapshotAnalysis,
} from '@/lib/depot/live/analysis';
import {
  createServiceHoldStore,
  defaultServiceHoldStore,
  heldBusesOnRoute,
  heldJourneysOnRoute,
  heldRouteHours,
  heldSlots,
  heldSummary,
  offerServiceSnapshot,
  SERVICE_HOLD_MAX_ROUTES,
  type ServiceHoldStore,
} from '@/lib/depot/live/serviceHold';

const rows = normalizeDepotRows(loadFleetFixture()).rows;
const ROUTE = 'VND_1613_ORD_OUT';
const DATE = '2026-10-06';
const at = (hhmm: string, date = DATE): string => `${date}T${hhmm}:00.000Z`;

function viewOf(
  feedNow: string | null,
  r: readonly DepotBusRow[] = rows,
  source: FleetSnapshotView['source'] = 'live',
): FleetSnapshotView {
  return { rows: r, feedNow, fetchedAt: at('02:30'), source, stale: false, recordCount: r.length };
}

let analysis: SnapshotAnalysis;
let store: ServiceHoldStore;

beforeEach(() => {
  resetAnalysisForTests();
  analysis = analyseSnapshot(viewOf(at('08:00'), rows, 'fixture'));
  store = createServiceHoldStore();
});

const offer = (feedNow: string | null, source: FleetSnapshotView['source'] = 'live'): void =>
  offerServiceSnapshot(store, viewOf(feedNow, rows, source), analysis);

describe('the service hold', () => {
  it('holds one sample per slot: the newest feed time wins, an equal or older one is ignored', () => {
    offer(at('08:01'));
    offer(at('08:03'));
    expect(heldSlots(store, DATE).map((s) => s.feedNow)).toEqual([at('08:03')]);
    offer(at('08:02'));
    offer(at('08:03'));
    expect(heldSlots(store, DATE).map((s) => s.feedNow)).toEqual([at('08:03')]);
    offer(at('08:05'));
    expect(heldSlots(store, DATE).map((s) => [s.slot, s.feedNow])).toEqual([
      [96, at('08:03')],
      [97, at('08:05')],
    ]);
  });

  it('starts afresh on a later operating date and ignores an earlier one', () => {
    offer(at('23:58'));
    offer(at('00:01', '2026-10-07'));
    expect(store.operatingDate).toBe('2026-10-07');
    expect(heldSlots(store, DATE)).toEqual([]);
    expect(heldSlots(store, '2026-10-07').map((s) => s.slot)).toEqual([0]);
    offer(at('23:59'));
    expect(store.operatingDate).toBe('2026-10-07');
    expect(heldSlots(store, '2026-10-07')).toHaveLength(1);
    expect(heldSummary(store, '2026-10-07')).toEqual({ since: '00:01', hours: 0, samples: 1 });
  });

  it('never writes for the recorded fixture or a snapshot with no feed clock', () => {
    offer(at('08:00'), 'fixture');
    offer(null);
    offer('not a time');
    expect(store.operatingDate).toBeNull();
    expect(heldSummary(store, DATE)).toBeNull();
  });

  it('caps the routes held for the date, admitting the busiest first', () => {
    offer(at('08:00'));
    const held = heldSlots(store, DATE)[0]!;
    expect(held.routes).toHaveLength(SERVICE_HOLD_MAX_ROUTES);
    expect(held.routes.some((r) => r.routeName === ROUTE)).toBe(true);
    expect(store.routeNames.size).toBe(SERVICE_HOLD_MAX_ROUTES);
  });

  it('caps the depots and routes of a store built with smaller limits', () => {
    store = createServiceHoldStore({ maxRoutes: 2, maxDepots: 3, maxJourneys: 4 });
    offer(at('08:00'));
    const held = heldSlots(store, DATE)[0]!;
    expect(held.routes).toHaveLength(2);
    expect(held.depots).toHaveLength(3);
    expect(store.journeys.size).toBe(4);
  });

  it('states since when it observed and how many samples it holds', () => {
    for (const hhmm of ['08:00', '08:05', '08:10', '08:15', '08:20', '08:25', '09:10']) {
      offer(at(hhmm));
    }
    expect(heldSummary(store, DATE)).toEqual({ since: '08:00', hours: 1, samples: 7 });
    expect(heldSummary(store, '2026-10-05')).toBeNull();
    const hours = heldRouteHours(store, ROUTE, DATE);
    expect(hours.map((h) => h.hour)).toEqual([8]);
    expect(hours[0]!.slotsObserved).toBe(6);
  });

  it('keeps the journey ledger and the distinct buses seen on a route for the date', () => {
    offer(at('08:00'));
    const onRoute = rows.filter((r) => r.routeName === ROUTE);
    expect(heldBusesOnRoute(store, ROUTE, DATE)).toBe(onRoute.length);
    const journeys = heldJourneysOnRoute(store, ROUTE, DATE);
    // The feed reuses journey ids across days; only this date's journeys enter the ledger.
    const ofDate = onRoute.filter(
      (r) =>
        r.journeyId !== null && (r.scheduledStart === null || r.scheduledStart.startsWith(DATE)),
    );
    expect(journeys.length).toBeGreaterThan(0);
    expect(journeys.length).toBe(new Set(ofDate.map((r) => r.journeyId)).size);
    expect(journeys.every((j) => j.routeName === ROUTE && j.lastSeen === at('08:00'))).toBe(true);
    expect(heldBusesOnRoute(store, ROUTE, '2026-10-05')).toBe(0);
    expect(heldJourneysOnRoute(store, ROUTE, '2026-10-05')).toEqual([]);
  });
});

describe('the service hold behind the snapshot analysis', () => {
  it('is offered once per snapshot, however often the snapshot is analysed', () => {
    // A rows array of its own: the one the other tests share is already analysed.
    const first = viewOf(at('08:01'), [...rows]);
    analyseSnapshot(first);
    analyseSnapshot({ ...first, feedNow: at('08:04') });
    expect(heldSlots(defaultServiceHoldStore(), DATE).map((s) => s.feedNow)).toEqual([at('08:01')]);
    analyseSnapshot(viewOf(at('08:04'), [...rows]));
    expect(heldSlots(defaultServiceHoldStore(), DATE).map((s) => s.feedNow)).toEqual([at('08:04')]);
  });

  it('is never written by the recorded fixture, and a reset empties it', () => {
    analyseSnapshot(viewOf(at('08:01'), [...rows], 'fixture'));
    expect(defaultServiceHoldStore().operatingDate).toBeNull();
    analyseSnapshot(viewOf(at('08:01'), [...rows]));
    expect(defaultServiceHoldStore().operatingDate).toBe(DATE);
    resetAnalysisForTests();
    expect(defaultServiceHoldStore().operatingDate).toBeNull();
    expect(defaultServiceHoldStore().slots.size).toBe(0);
  });
});
