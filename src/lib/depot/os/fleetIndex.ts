import type { DepotFeedEnvelope } from '../api';
import { gpsAgeMinutes } from '../infer/busState';
import { hasUsablePosition } from '../infer/geo';
import { analyseSnapshot, feedEnvelope } from '../live/analysis';
import type { FleetSnapshotView } from '../repositories/types';
import { compareText } from '../stats/order';
import type { BusOpState } from '../types';

/**
 * Every bus on the snapshot in one compact row, for the OS's network-wide engines (fuel
 * audit, fleet health, the command palette's bus search). It reads the shared analysis,
 * so a bus's state here is the state every depot page shows.
 *
 * A row is a tuple to keep the payload small for thousands of buses:
 * [registration, home depot id or null, state, route name or null, lat, lng, GPS age in
 * whole minutes]. A missing value stays null: it never becomes zero.
 */
export type FleetIndexRow = readonly [
  registration: string,
  depotId: string | null,
  state: BusOpState,
  routeName: string | null,
  lat: number | null,
  lng: number | null,
  gpsAgeMin: number | null,
];

export interface FleetIndexResponse extends DepotFeedEnvelope {
  readonly buses: readonly FleetIndexRow[];
}

const COORD_PLACES = 1e5;

export function buildFleetIndex(view: FleetSnapshotView): FleetIndexResponse {
  const analysis = analyseSnapshot(view);
  const buses: FleetIndexRow[] = [];
  for (const rows of analysis.rowsByDepot.values()) {
    for (const row of rows) {
      const positioned = hasUsablePosition(row);
      const age = gpsAgeMinutes(row, analysis.feedNow);
      buses.push([
        row.registrationNumber,
        row.depotId,
        analysis.stateOf(row),
        row.routeName,
        positioned ? Math.round(row.latitude * COORD_PLACES) / COORD_PLACES : null,
        positioned ? Math.round(row.longitude * COORD_PLACES) / COORD_PLACES : null,
        age === null ? null : Math.round(age),
      ]);
    }
  }
  buses.sort((a, b) => compareText(a[0], b[0]));
  return { ...feedEnvelope(view), buses };
}

export interface FleetBus {
  readonly registration: string;
  readonly depotId: string | null;
  readonly state: BusOpState;
  readonly routeName: string | null;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly gpsAgeMin: number | null;
}

export function fleetBusOf(row: FleetIndexRow): FleetBus {
  const [registration, depotId, state, routeName, lat, lng, gpsAgeMin] = row;
  return { registration, depotId, state, routeName, lat, lng, gpsAgeMin };
}
