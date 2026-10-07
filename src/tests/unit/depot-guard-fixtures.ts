import type { DepotBusRow } from '@/models/depotLive';
import { createServiceHoldStore } from '@/lib/depot/live/serviceHold';
import type { NetworkHourlyQuery } from '@/lib/depot/live/networkHourlyView';
import type { RouteHourlyQuery } from '@/lib/depot/live/routeHourlyView';
import { createMemoryHourlyObservationRepository } from '@/lib/depot/repositories/memoryHourlyObservationRepository';
import { createMemoryScheduledTripRepository } from '@/lib/depot/repositories/memoryScheduledTripRepository';
import type { FleetSnapshotView, ServiceRepositories } from '@/lib/depot/repositories/types';

/*
 * One small, valid fleet snapshot for the depot guards: three depots of
 * twenty buses each, in a mix of live states, on a handful of routes. The
 * feed clock is in the feed's own shape (Indian digits with a `Z`).
 */

export const GUARD_FEED_NOW = '2026-10-06T08:00:00Z';
const ROUTES = ['AGRA_EXP_1', 'KANPUR_ORD_2', 'DELHI_AC_3'] as const;
/** A route the guard snapshot carries, for the views and routes of one route. */
export const GUARD_ROUTE = ROUTES[0];

function row(over: Partial<DepotBusRow>): DepotBusRow {
  return {
    registrationNumber: 'UP32A0001', latitude: 26.85, longitude: 80.95, speedKmph: 0,
    ignitionOn: false, gpsTimestamp: GUARD_FEED_NOW, receivedAt: GUARD_FEED_NOW, depotId: '1',
    depotName: 'Depot 1', vehicleStatus: 'stationary', tripStatus: 'Stationary', routeId: null,
    routeName: null, routeDescription: null, journeyId: null, journeyCode: null,
    scheduledStart: null, scheduledEnd: null, actualStart: null, delayMinutes: null,
    odometerRaw: null, mainPowerOn: true, mainVoltage: null, tamperCode: 'C', emergency: false,
    ...over,
  };
}

function depotRows(depotId: string): DepotBusRow[] {
  return Array.from({ length: 20 }, (_, i) => {
    const base = {
      registrationNumber: `UP${depotId}G${i}`, depotId, depotName: `Depot ${depotId}`,
      routeName: ROUTES[i % ROUTES.length],
    };
    if (i < 6) return row({ ...base, speedKmph: 30, latitude: 27.2, vehicleStatus: 'live' });
    if (i < 8) return row({ ...base, vehicleStatus: 'no_signal' });
    if (i < 10) return row({ ...base, vehicleStatus: 'under_maintenance' });
    return row(base);
  });
}

export function guardView(): FleetSnapshotView {
  const rows = ['1', '2', '3'].flatMap(depotRows);
  return {
    rows, feedNow: GUARD_FEED_NOW, fetchedAt: '2026-10-06T08:00:05.000Z', source: 'live',
    stale: false, recordCount: rows.length,
  };
}

/** The hour-by-hour stores, empty and private to the caller. */
export function guardServiceRepositories(): ServiceRepositories {
  return {
    hourly: createMemoryHourlyObservationRepository(createServiceHoldStore()),
    scheduled: createMemoryScheduledTripRepository(),
  };
}

/** One route of the guard snapshot, on the feed's own date. */
export function guardRouteHourlyQuery(): RouteHourlyQuery {
  return { routeName: GUARD_ROUTE, date: null };
}

/** The network's hours for the peak now or next, every depot, the first page. */
export function guardNetworkHourlyQuery(): NetworkHourlyQuery {
  return { band: null, depotId: null, page: 0 };
}
