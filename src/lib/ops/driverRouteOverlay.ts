/**
 * Turning the driver's upcoming stops into marks the shared fleet map can
 * draw.
 *
 * A pure builder, sitting outside the map for the same reason
 * `buildIncidentOverlay` does: the renderer
 * (src/components/map/fleetCanvasLayer.ts) knows about points, rings and
 * paths, and must never learn what an arrival prediction is. Everything
 * domain-shaped happens here, where it can be tested without a browser.
 *
 * ─── THE TWO GEOMETRY HONESTY RULES ──────────────────────────────────────
 *
 *   1. A STOP WITH NO POSITION IS NOT DRAWN. Not at (0, 0), not at the
 *      previous stop, not at the bus. `src/lib/maps/plottable.ts` exists
 *      because one `latitude 0.000` reading in the live feed opened the
 *      statewide console on empty ocean; the same rule is applied here, to
 *      stop rows rather than vehicle rows, and the count of what was dropped
 *      is returned so the surface can declare it rather than silently
 *      shrinking the driver's route.
 *
 *   2. THE LINE THROUGH THE STOPS IS DASHED. It joins stop positions with
 *      straight chords - it is not the surveyed route shape and it is not the
 *      road. Drawn solid, a driver glancing at it would read it as the way to
 *      go, which on a corridor that bends around a river is a straight line
 *      through the river. Dashed, it reads as what it is: these stops, in this
 *      order.
 */
import type { FleetMapOverlay, FleetMapOverlayMark, MapPoint } from '@/lib/maps/contract';
import { isPlottablePosition } from '@/lib/maps/plottable';
import type { JourneyStop } from './driverJourney';

/**
 * Ring colours, carrying the one distinction this product exists to make.
 *
 * A stop the model produced a time for and a stop it declined to time are
 * different claims, and they must not look the same on the map any more than
 * they may in the list. Cyan is the console's instrument accent (the same
 * `holo.glow` every other live reading uses); the withdrawn stops take the
 * muted tier, which is the surface's own "this is real but is not what you are
 * reading" grey.
 */
const TIMED_COLOUR = '#3ff0ff';
const UNTIMED_COLOUR = '#7e93a6';
/** The chord path between stops. One step quieter again - it is context, not a reading. */
const PATH_COLOUR = '#1d4a6e';

export interface RouteStopOverlayResult {
  overlay: FleetMapOverlay;
  /**
   * Stops that could not be drawn because their position is missing or is not
   * on the served network.
   *
   * Returned rather than swallowed: a map that quietly omits a stop has
   * shortened the driver's route without telling them, which is the same class
   * of mistake as drawing a stop in the sea.
   */
  undrawnStopCount: number;
}

/** True when this stop can honestly be put on the map. */
function drawable(stop: JourneyStop): stop is JourneyStop & { latitude: number; longitude: number } {
  return (
    stop.latitude !== null &&
    stop.longitude !== null &&
    isPlottablePosition(stop.latitude, stop.longitude)
  );
}

export function buildRouteStopOverlay(
  stops: readonly JourneyStop[],
  overlayId = 'driver-route-stops',
): RouteStopOverlayResult {
  const drawableStops = stops.filter(drawable);
  const undrawnStopCount = stops.length - drawableStops.length;

  if (drawableStops.length === 0) {
    return { overlay: { id: overlayId, marks: [] }, undrawnStopCount };
  }

  const marks: FleetMapOverlayMark[] = [];

  // The connecting chords first, and `beneath` is not set on the group because
  // the driver's own bus is the only vehicle on this map - there is no chevron
  // field for this to sit under, and drawn beneath it would disappear under
  // the basemap's own road casing.
  if (drawableStops.length > 1) {
    marks.push({
      id: `${overlayId}-path`,
      points: drawableStops.map((stop) => ({ latitude: stop.latitude, longitude: stop.longitude })),
      colour: PATH_COLOUR,
      radiusPx: 3,
      dashed: true,
    });
  }

  drawableStops.forEach((stop, index) => {
    marks.push({
      id: `${overlayId}-${stop.stopId}`,
      points: [{ latitude: stop.latitude, longitude: stop.longitude }],
      colour: stop.arrival.status === 'predicted' ? TIMED_COLOUR : UNTIMED_COLOUR,
      // The next stop is the one the driver is actually about to serve, so it
      // gets the larger ring and the only caption on the map. Every other stop
      // is a ring; their names and times are in the list below, where there is
      // room to read them.
      radiusPx: index === 0 ? 11 : 7,
      label: index === 0 ? 'NEXT' : undefined,
    });
  });

  return { overlay: { id: overlayId, marks }, undrawnStopCount };
}

/**
 * The points the camera should open over: the bus, and every stop that can
 * honestly be drawn.
 *
 * Separated from the overlay builder because the camera is where a single bad
 * reading does the most damage - `fitBounds` takes the extremes of whatever it
 * is handed, which is exactly how one equator-latitude vehicle centred the
 * whole console on peninsular India. Everything returned here has already
 * passed the served-network test.
 */
export function cameraFitPoints(
  vehicle: MapPoint | null,
  stops: readonly JourneyStop[],
): MapPoint[] {
  const points: MapPoint[] = [];

  if (vehicle && isPlottablePosition(vehicle.latitude, vehicle.longitude)) {
    points.push({ latitude: vehicle.latitude, longitude: vehicle.longitude });
  }
  for (const stop of stops) {
    if (drawable(stop)) points.push({ latitude: stop.latitude, longitude: stop.longitude });
  }

  return points;
}
