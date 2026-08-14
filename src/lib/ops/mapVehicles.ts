/**
 * Pure builders that turn already-scoped ops data into what the map draws.
 *
 * No `server-only` guard and no I/O, for the same reason depotScope.ts and
 * fleetView.ts have none: the depot boundary these functions sit on must be
 * exhaustively testable without a database, a network or a browser. The I/O
 * half - fetching the fleet and the control-service state, and resolving WHICH
 * depot the caller owns - is server-only and lives in mapData.ts.
 *
 * THE BOUNDARY PROPERTY, stated once because everything here depends on it:
 * `toOpsMapVehicles` iterates the SCOPED fleet and treats control-service
 * vehicle states purely as an enrichment lookup. A vehicle state has no depot
 * of its own (the two datastores are deliberately never joined -
 * docs/CONTROL_SERVICE_INTEGRATION.md §1, §3), so if it were the thing being
 * iterated, a depot operator's map would draw every vehicle control-service
 * knows about. Iterating the scoped fleet instead means an unscoped state row
 * cannot produce a marker at all: there is nothing to attach it to. The same
 * property carries the incident overlay, which resolves member positions from
 * the vehicles this function produced and drops the members it cannot find.
 */
import type { FleetMapOverlay, FleetMapOverlayMark, MapVehicle } from '@/lib/maps/contract';
import type { CanonicalLiveBus } from '@/models/canonical';
import type { BunchingIncident, IncidentSeverity, StopState, VehicleState } from '@/models/control';

/**
 * Where the drawn position came from.
 *
 * Surfaced per vehicle rather than per snapshot because a control room needs
 * to know it: the control-service estimate is the position the decision engine
 * and the headway detector actually reason about, while the upstream GPS feed
 * is the raw fix. When they disagree, an operator judging a hold needs to know
 * which one the chevron is standing on.
 */
export type OpsMapPositionSource = 'control-service' | 'live-feed';

export interface OpsMapVehicle extends MapVehicle {
  /** Canonical vehicle key - the registration number, the same id control-service's `vehicles` table is keyed on. */
  id: string;
  registrationNumber: string;
  depotName: string | null;
  routeName: string | null;
  speedKmph: number | null;
  /** Control-service's classification, present only where a vehicle state was matched. */
  stopState: StopState | null;
  routeDirectionId: string | null;
  positionSource: OpsMapPositionSource;
  /** ISO timestamp of the fix being drawn - from whichever source won. */
  observedAt: string;
}

/**
 * The scoped fleet, enriched with control-service positions where they exist.
 *
 * Control-service wins when it has a fix, because it is the estimate the rest
 * of the operational system is built on: the headway detector, the incident
 * lifecycle and the MPC solver all reason about it, so a map drawn from
 * anything else would show an operator a different fleet from the one the
 * alerts are about. Where control-service has no fix - it only tracks vehicles
 * on a modelled route-direction - the upstream GPS position stands, flagged as
 * such, rather than the vehicle vanishing off the map.
 *
 * `vehicleStates` must already be narrowed to the caller's scope (see
 * `filterVehicleStatesToScope`). Passing an unscoped list is not a leak here -
 * the iteration order makes an unmatched state inert - but it is still wrong,
 * and mapData.ts narrows before calling.
 */
export function toOpsMapVehicles(
  scopedBuses: readonly CanonicalLiveBus[],
  vehicleStates: readonly VehicleState[] = [],
): OpsMapVehicle[] {
  const states = new Map<string, VehicleState>();
  for (const state of vehicleStates) states.set(state.vehicleId, state);

  const out: OpsMapVehicle[] = [];
  for (const bus of scopedBuses) {
    const state = states.get(bus.id);
    const position = state?.position;
    // `position` is nullable AND optional on the wire (src/models/control.ts):
    // null means "this vehicle has no fix", absent means "this deployment's
    // endpoint does not send one". Both fall back to the GPS feed, and neither
    // is allowed to produce a vehicle drawn at 0,0.
    const fix = position ?? null;

    out.push({
      id: bus.id,
      registrationNumber: bus.registrationNumber,
      // Latitude/longitude are never widened to null: a vehicle the map cannot
      // honestly place is not drawn at all, and CanonicalLiveBus already
      // guarantees a fix (src/models/canonical.ts).
      latitude: fix === null ? bus.latitude : fix.latitude,
      longitude: fix === null ? bus.longitude : fix.longitude,
      headingDegrees: fix === null ? bus.headingDegrees : (state?.headingDegrees ?? bus.headingDegrees),
      dataQuality: bus.dataQuality,
      depotName: bus.depotName,
      routeName: bus.routeName,
      speedKmph: (fix === null ? bus.speedKmph : (state?.speedKmph ?? bus.speedKmph)) ?? null,
      stopState: state?.stopState ?? null,
      routeDirectionId: state?.routeDirectionId ?? null,
      positionSource: fix === null ? 'live-feed' : 'control-service',
      observedAt: fix === null || state === undefined ? bus.lastUpdatedAt : state.observedAt,
    });
  }
  return out;
}

/**
 * Overlay colours by severity. Deliberately distinct from the vehicle
 * quality palette (green/amber/red in fleetCanvasLayer.ts) at the two ends: an
 * incident ring must not be mistaken for a stale-GPS chevron.
 */
const SEVERITY_COLOUR: Record<IncidentSeverity, string> = {
  warning: '#ffd166',
  bunched: '#ff8a3d',
  severe: '#ff4d5e',
};

const SEVERITY_LABEL: Record<IncidentSeverity, string> = {
  warning: 'WARNING',
  bunched: 'BUNCHED',
  severe: 'SEVERE',
};

/** Leader first, then follower, then the rest - so the drawn link reads in the direction of travel. */
const ROLE_ORDER: Record<BunchingIncident['members'][number]['role'], number> = {
  leader: 0,
  follower: 1,
  platoon_member: 2,
};

export interface IncidentOverlayResult {
  overlay: FleetMapOverlay;
  /** Incidents with at least one member drawable on this operator's map. */
  renderedIncidentIds: string[];
  /**
   * Incidents that could not be drawn at all, because none of their vehicles
   * are in this operator's scope or currently reporting a position.
   *
   * Returned rather than swallowed so the control room can say so out loud.
   * A depot operator genuinely should not see an incident between two other
   * depots' buses; being told "3 incidents on this route involve vehicles
   * outside your depot" is very different from a map that quietly shows two.
   */
  unresolvedIncidentIds: string[];
}

/**
 * Turn real bunching incidents into overlay geometry.
 *
 * Positions come from `vehicles` - the list already drawn on this operator's
 * map - because a `BunchingIncident` carries member vehicle ids and no
 * coordinates (src/models/control.ts). That is what keeps the overlay inside
 * the same boundary as the fleet underneath it: a member the caller cannot see
 * has no position to resolve, so it cannot be plotted, and an incident whose
 * members are all out of scope produces no mark at all.
 *
 * Closed incidents are dropped. `GET /v1/incidents` already returns only the
 * open set, but the single-incident read does not, and an overlay is a
 * statement about right now.
 */
export function buildIncidentOverlay(
  incidents: readonly BunchingIncident[],
  vehicles: readonly OpsMapVehicle[],
  overlayId = 'bunching-incidents',
): IncidentOverlayResult {
  const byId = new Map<string, OpsMapVehicle>();
  for (const vehicle of vehicles) byId.set(vehicle.id, vehicle);

  const marks: FleetMapOverlayMark[] = [];
  const renderedIncidentIds: string[] = [];
  const unresolvedIncidentIds: string[] = [];

  for (const incident of incidents) {
    if (incident.status === 'closed') continue;

    const points = [...incident.members]
      .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role])
      .map((member) => byId.get(member.vehicleId))
      .filter((vehicle): vehicle is OpsMapVehicle => vehicle !== undefined)
      .map((vehicle) => ({ latitude: vehicle.latitude, longitude: vehicle.longitude }));

    if (points.length === 0) {
      unresolvedIncidentIds.push(incident.id);
      continue;
    }

    marks.push({
      id: incident.id,
      points,
      colour: SEVERITY_COLOUR[incident.severity],
      radiusPx: incident.severity === 'warning' ? 9 : 12,
      // Only the group gets a label; with two rings and a link, one caption is
      // the readable amount of text over a dense chevron field.
      label: SEVERITY_LABEL[incident.severity],
      dashed: true,
    });
    renderedIncidentIds.push(incident.id);
  }

  return { overlay: { id: overlayId, marks }, renderedIncidentIds, unresolvedIncidentIds };
}
