/**
 * The data contract between whoever produces map data and whoever draws it.
 *
 * Deliberately tiny, and deliberately NOT `CanonicalLiveBus`. The canvas
 * layer (src/components/map/fleetCanvasLayer.ts) is the only proven
 * high-volume renderer in this app, and it was welded to the /project
 * command-centre's canonical bus shape. Two surfaces now need it - the
 * cinematic command centre and the real ops dashboards - and their vehicle
 * records genuinely differ (an ops vehicle carries a position provenance and
 * a depot; a command-centre bus carries occupancy, scenario flags and a
 * dozen presentation fields the map never reads).
 *
 * Rather than fork the renderer or widen one product's model to cover the
 * other, both pass something that satisfies `MapVehicle`. The renderer stays
 * generic over the caller's own type, so a click handler still receives the
 * caller's full record with no cast.
 *
 * No `server-only` guard and no I/O: these types cross the server/client
 * boundary as plain JSON, and the pure builders that produce them
 * (src/lib/ops/mapVehicles.ts) must be unit-testable without a browser.
 */
import type { DataQuality } from '@/models/canonical';

/** A geographic vertex. Matches control.ts's `geoPointSchema` field naming on purpose. */
export interface MapPoint {
  latitude: number;
  longitude: number;
}

/**
 * The minimum a vehicle must carry to be drawn.
 *
 * `dataQuality` is part of the minimum rather than an optional extra because
 * the renderer colours by it: a map that draws a 40-minute-old fix
 * identically to a 5-second-old one is a map that lies about what it knows.
 */
export interface MapVehicle extends MapPoint {
  id: string;
  headingDegrees: number | null;
  dataQuality: DataQuality;
}

/**
 * One drawable annotation.
 *
 * Geometry only - no incident, no route, no domain object. The renderer must
 * not learn what a bunching incident is, or the next overlay (a corridor, a
 * geofence, a depot catchment) means editing the renderer again. Domain
 * objects are turned into marks by a pure builder outside the map; see
 * `buildIncidentOverlay` in src/lib/ops/mapVehicles.ts for the worked example
 * the control room uses.
 *
 * `points` is ordered:
 *   - one point  -> a ring at that position
 *   - two or more -> a path through them, with a ring at every vertex
 *
 * That single rule covers "highlight this vehicle" and "these two vehicles
 * are bunched together" without a shape enum.
 */
export interface FleetMapOverlayMark {
  /** Stable identity, so React keys and future hit-testing have something to hold. */
  id: string;
  points: readonly MapPoint[];
  /** CSS colour for the stroke and rings. */
  colour: string;
  /** Ring radius in CSS pixels. Defaults to 9. Not scaled by zoom: an annotation is chrome, not terrain. */
  radiusPx?: number;
  /** Short text drawn once, above the first vertex. Keep it to a couple of words. */
  label?: string;
  /** Dash the connecting path, so an annotation never reads as a route line. */
  dashed?: boolean;
}

export interface FleetMapOverlay {
  id: string;
  marks: readonly FleetMapOverlayMark[];
  /**
   * Draw under the vehicle chevrons instead of over them. Use it for area or
   * corridor context; leave it off for anything the operator must not miss.
   */
  beneath?: boolean;
}
