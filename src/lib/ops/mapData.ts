import 'server-only';

/**
 * Server-only data source for the ops fleet map.
 *
 * The I/O half of the map's depot boundary. It composes three sources that
 * already exist and adds no new fetch of its own:
 *
 *   1. `getOpsFleetSnapshot(scope)` - the SCOPED live fleet. The membership
 *      list, and the only thing here that knows a vehicle's depot.
 *   2. `GET /v1/vehicle-states` - control-service's own estimate, which now
 *      carries `position` and `headingDegrees`.
 *   3. `GET /v1/incidents` - real bunching incidents for the overlay.
 *
 * WHY THIS IS A SERVER MODULE AND NOT A CLIENT FETCH. The obvious way to put
 * a map on an ops dashboard is to have the browser poll the statewide feed and
 * filter it for display. That would hand every depot operator the whole
 * ~9,170-vehicle fleet in a network response - the exact boundary
 * db/migrations/20260812150000__ops_depot_ownership.sql just closed - and it
 * would be invisible in the UI, because the map would look correctly scoped.
 * The narrowing therefore happens here, before serialisation: what the browser
 * receives IS what the operator owns. The polling route
 * (src/app/api/ops/fleet/map/route.ts) resolves the scope from the caller's
 * own ops_users row and never accepts a depot from the request, so there is no
 * parameter to tamper with.
 *
 * Never throws: an ops dashboard has to render something, and the same
 * fresh -> stale -> explicitly-unavailable ladder every other ops read uses
 * applies here (src/lib/ops/fleetData.ts, src/lib/controlService/routeBoardData.ts).
 */
import { ControlServiceConfigError, fetchControlService } from '@/lib/controlService/client';
import {
  incidentsResponseSchema,
  vehicleStatesResponseSchema,
  type BunchingIncident,
  type VehicleState,
} from '@/models/control';
import { getOpsFleetSnapshot, type OpsFleetSnapshot } from './fleetData';
import { filterVehicleStatesToScope, scopeLabel, type OpsFleetScope } from './depotScope';
import { toOpsMapVehicles, type OpsMapVehicle } from './mapVehicles';

export interface OpsMapSnapshot {
  /** Every vehicle this caller may see, positioned. Already narrowed - there is no wider list behind it. */
  vehicles: OpsMapVehicle[];
  /**
   * Open bunching incidents on the selected route-direction, narrowed to
   * incidents with at least one member in `vehicles`. Empty when no
   * route-direction was requested: `/v1/incidents` is per-corridor, and
   * fanning out across every route-direction on each poll is a different
   * (and much more expensive) product.
   */
  incidents: BunchingIncident[];
  /** Human label for the boundary in force, for the map's own caption. Never a count the operator cannot verify. */
  scopeLabel: string;
  /** Provenance of the fleet half - 'live', 'cache', 'fixture' or 'unavailable'. */
  source: OpsFleetSnapshot['source'];
  stale: boolean;
  fetchedAt: string;
  /** Non-null when the fleet read itself degraded. */
  error: string | null;
  /**
   * Non-null when control-service could not be reached. Separate from `error`
   * on purpose: the map still draws every vehicle from the GPS feed in that
   * case, so this is a partial degradation ("positions are the raw feed, not
   * the operational estimate, and there are no incidents"), not an outage.
   */
  controlServiceError: string | null;
}

/**
 * Everything the ops map needs, for one caller, already scoped.
 *
 * `scope` is REQUIRED and has no default, matching getOpsFleetSnapshot. An
 * omitted scope must never mean "statewide" on an authorization boundary;
 * resolve it with `resolveOpsFleetScope` from the caller's own session and
 * refuse when it says no.
 */
export async function getOpsMapSnapshot(
  scope: OpsFleetScope,
  options: { routeDirectionId?: string } = {},
): Promise<OpsMapSnapshot> {
  const { routeDirectionId } = options;
  const snapshot = await getOpsFleetSnapshot(scope);

  let vehicleStates: VehicleState[] = [];
  let incidents: BunchingIncident[] = [];
  let controlServiceError: string | null = null;

  if (routeDirectionId !== undefined && routeDirectionId !== '') {
    const loaded = await loadControlServiceState(routeDirectionId);
    controlServiceError = loaded.error;
    // Narrowed against THIS caller's scoped fleet before it is used for
    // anything - see filterVehicleStatesToScope for why an intersection is the
    // only depot signal available without joining the two datastores.
    vehicleStates = filterVehicleStatesToScope(loaded.vehicleStates, scope, snapshot.buses);
    incidents = loaded.incidents;
  }

  const vehicles = toOpsMapVehicles(snapshot.buses, vehicleStates);

  // An incident is kept only when at least one of its members is a vehicle
  // this caller can see. A depot operator is not shown an incident between two
  // other depots' buses, and the overlay builder could not have drawn it
  // anyway - this drops it from the payload too, rather than shipping an
  // undrawable record to the browser.
  const visible = new Set(vehicles.map((vehicle) => vehicle.id));
  const scopedIncidents =
    scope.kind === 'all'
      ? incidents
      : incidents.filter((incident) => incident.members.some((member) => visible.has(member.vehicleId)));

  return {
    vehicles,
    incidents: scopedIncidents,
    scopeLabel: scopeLabel(scope),
    source: snapshot.source,
    stale: snapshot.stale,
    fetchedAt: snapshot.fetchedAt,
    error: snapshot.error,
    controlServiceError,
  };
}

/**
 * The control-service half, as one best-effort read.
 *
 * Both calls share a failure: if the service is unreachable there are neither
 * positions nor incidents, and the map falls back to GPS-feed positions with
 * no overlay. That is a strictly better outcome than failing the whole map,
 * and it is stated in the snapshot rather than hidden.
 */
async function loadControlServiceState(routeDirectionId: string): Promise<{
  vehicleStates: VehicleState[];
  incidents: BunchingIncident[];
  error: string | null;
}> {
  try {
    const [vehiclesRaw, incidentsRaw] = await Promise.all([
      fetchControlService('/v1/vehicle-states', { query: { routeDirectionId } }),
      fetchControlService('/v1/incidents', { query: { routeDirectionId } }),
    ]);
    return {
      vehicleStates: vehicleStatesResponseSchema.parse(vehiclesRaw).vehicleStates,
      incidents: incidentsResponseSchema.parse(incidentsRaw).incidents,
      error: null,
    };
  } catch (cause) {
    const message =
      cause instanceof ControlServiceConfigError
        ? cause.message
        : cause instanceof Error
          ? cause.message
          : 'Unknown control-service error';
    return { vehicleStates: [], incidents: [], error: message };
  }
}
