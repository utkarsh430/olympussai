/**
 * Turning a rehearsal frame into marks the shared fleet map can draw.
 *
 * ─── WHY SIMULATED BUSES ARE OVERLAY MARKS AND NOT VEHICLES ──────────────
 *
 * `OpsFleetMap` takes a `vehicles` array of `OpsMapVehicle`, and the
 * renderer colours those by `dataQuality` - how old the GPS fix is. A
 * simulated bus has no GPS fix, so every value of that field would be a
 * claim this surface has no basis for, and a green "Fresh" chevron is
 * precisely the claim it must never make. Filling the field with something
 * plausible is how a simulator starts looking like operations.
 *
 * So the simulated fleet is drawn as ANNOTATIONS on a real corridor:
 * `vehicles` stays empty, and every bus is an overlay mark whose colour
 * carries the only thing that is true about it - what the model has it
 * doing. The map is the proven canvas renderer either way; nothing here is
 * a second map.
 *
 * Pure and I/O-free, like `buildIncidentOverlay` and
 * `buildRouteStopOverlay` before it, and for the same reason: the renderer
 * must never learn what a rehearsal is.
 */
import type { FleetMapOverlay, FleetMapOverlayMark, MapPoint } from '@/lib/maps/contract';
import { isPlottablePosition } from '@/lib/maps/plottable';
import type { RehearsalFrame, RehearsalStop, RehearsalVehicleFrame } from '@/models/rehearsal';

/**
 * Corridor colours, one step quieter than the buses on it: the road is
 * context, the buses are the reading. `PATH_COLOUR` is the same value the
 * driver's route overlay uses for the same job.
 */
const PATH_COLOUR = '#1d4a6e';
const CONTROL_POINT_COLOUR = '#3ff0ff';
const STOP_COLOUR = '#7e93a6';

/**
 * Simulated-bus colours, keyed to what the MODEL has the bus doing - never
 * to a data quality, because there is no data.
 *
 * Amber for a held bus is deliberate and matches `OpsBadge variant="sim"`'s
 * own dot: a hold is the thing a planner opened this surface to see, and it
 * must be findable on the map without reading the decision table.
 */
const RUNNING_COLOUR = '#8ea9c1';
const DWELLING_COLOUR = '#3ff0ff';
const HELD_COLOUR = '#ffb020';
/** The bus the disturbance was aimed at, so it can be picked out of the run. */
const DISTURBED_COLOUR = '#ff4d5e';

export const REHEARSAL_MAP_LEGEND: readonly { colour: string; label: string }[] = [
  { colour: RUNNING_COLOUR, label: 'Running' },
  { colour: DWELLING_COLOUR, label: 'At a stop' },
  { colour: HELD_COLOUR, label: 'Held by the control law' },
  { colour: DISTURBED_COLOUR, label: 'Disturbed in this scenario' },
];

export const CORRIDOR_OVERLAY_ID = 'rehearsal-corridor';
export const FLEET_OVERLAY_ID = 'rehearsal-fleet';

/**
 * The corridor itself: the surveyed shape, with a ring at every stop and a
 * brighter one at every control point.
 *
 * Drawn beneath, because it is terrain. A stop whose position is not on the
 * served network is dropped rather than placed at (0, 0) - the same rule
 * `src/lib/maps/plottable.ts` exists for, applied to stop rows.
 */
export function buildCorridorOverlay(
  stops: readonly RehearsalStop[],
  shape: readonly MapPoint[],
): FleetMapOverlay {
  const marks: FleetMapOverlayMark[] = [];

  const drawableShape = shape.filter((point) => isPlottablePosition(point.latitude, point.longitude));
  if (drawableShape.length >= 2) {
    marks.push({
      id: `${CORRIDOR_OVERLAY_ID}-path`,
      points: drawableShape,
      colour: PATH_COLOUR,
      // Zero-radius rings: the shape's vertices are geometry, not stops, and
      // ringing them would invent a stop wherever the survey happened to
      // change direction.
      radiusPx: 0,
    });
  }

  for (const stop of stops) {
    if (!isPlottablePosition(stop.latitude, stop.longitude)) continue;
    marks.push({
      id: `${CORRIDOR_OVERLAY_ID}-stop-${stop.stopId}`,
      points: [{ latitude: stop.latitude, longitude: stop.longitude }],
      colour: stop.isControlPoint ? CONTROL_POINT_COLOUR : STOP_COLOUR,
      radiusPx: stop.isControlPoint ? 7 : 4,
    });
  }

  return { id: CORRIDOR_OVERLAY_ID, marks, beneath: true };
}

/** The colour a simulated bus is drawn in - what the model has it doing, and nothing else. */
export function simulatedVehicleColour(
  vehicle: Pick<RehearsalVehicleFrame, 'vehicleId' | 'status'>,
  disturbedVehicleId: string | null,
): string {
  if (vehicle.vehicleId === disturbedVehicleId) return DISTURBED_COLOUR;
  if (vehicle.status === 'held') return HELD_COLOUR;
  if (vehicle.status === 'dwelling') return DWELLING_COLOUR;
  return RUNNING_COLOUR;
}

/**
 * One frame of the run, as marks.
 *
 * Every bus is labelled with its own simulated id (`SIM-01`, …), which is
 * the second half of the guarantee that nothing on this map can be read as
 * a real vehicle: the identifiers are visibly not registration numbers.
 */
export function buildSimulatedFleetOverlay(
  frame: RehearsalFrame | null,
  disturbedVehicleId: string | null,
): FleetMapOverlay {
  if (!frame) return { id: FLEET_OVERLAY_ID, marks: [] };

  const marks: FleetMapOverlayMark[] = [];
  for (const vehicle of frame.vehicles) {
    if (!isPlottablePosition(vehicle.latitude, vehicle.longitude)) continue;
    marks.push({
      id: `${FLEET_OVERLAY_ID}-${vehicle.vehicleId}`,
      points: [{ latitude: vehicle.latitude, longitude: vehicle.longitude }],
      colour: simulatedVehicleColour(vehicle, disturbedVehicleId),
      radiusPx: vehicle.status === 'held' ? 11 : 9,
      label: vehicle.vehicleId,
    });
  }
  return { id: FLEET_OVERLAY_ID, marks };
}

/** Camera target: the corridor, so a run opens on the whole road rather than on whichever bus happens to lead. */
export function corridorFitPoints(
  stops: readonly RehearsalStop[],
  shape: readonly MapPoint[],
): MapPoint[] {
  const source = shape.length >= 2 ? shape : stops;
  return source
    .map((point) => ({ latitude: point.latitude, longitude: point.longitude }))
    .filter((point) => isPlottablePosition(point.latitude, point.longitude));
}
