// Putting a distance-along-route back onto the map.
//
// The simulator reasons entirely in metres along the corridor, because that
// is the coordinate the deployed headway computation uses. To draw the run,
// each of those distances has to become a lat/lon on the surveyed shape.
//
// MEASURED on this database: for all 198 calibrated route-directions the
// last stop's `cumulative_distance_meters` equals `route_shapes.
// total_distance_meters` exactly, so stop distances and the polyline share
// one scale and a fraction of the total is a fraction of the polyline. The
// scaling below is written against that fact rather than assuming it: the
// polyline's own summed length is used as the ruler, so a shape whose
// vertices imply a different length still yields a point ON the shape rather
// than off the end of it.
import { bearingDegrees, haversineDistanceMeters } from '../state-estimation/geometry.js';

export interface ShapePoint {
  latitude: number;
  longitude: number;
}

export interface PlacedPoint extends ShapePoint {
  /** Direction of travel at this point, from the polyline segment it sits on. Null when the shape gives nothing to take a bearing from. */
  headingDegrees: number | null;
}

/**
 * Cumulative length at each vertex, and the polyline's total.
 *
 * Precomputed once per rehearsal rather than per frame: a 60-frame run over
 * 8 vehicles asks for 480 placements, and re-walking the polyline for each
 * one turns a linear job into a quadratic one for no reason.
 */
export interface ShapeRuler {
  points: readonly ShapePoint[];
  cumulative: readonly number[];
  polylineLengthMeters: number;
}

export function buildShapeRuler(points: readonly ShapePoint[]): ShapeRuler | null {
  if (points.length < 2) return null;
  const cumulative: number[] = [0];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1];
    const current = points[i];
    if (!previous || !current) return null;
    total += haversineDistanceMeters(
      { lat: previous.latitude, lon: previous.longitude },
      { lat: current.latitude, lon: current.longitude },
    );
    cumulative.push(total);
  }
  if (total <= 0) return null;
  return { points, cumulative, polylineLengthMeters: total };
}

/**
 * The point `distanceMeters` along a route of length `routeLengthMeters`.
 *
 * Returns null rather than a clamped endpoint when the distance is outside
 * the route: a vehicle that is not on the corridor must not be drawn AT the
 * terminus, which is a real position and would be read as one.
 */
export function placeAlongShape(
  ruler: ShapeRuler,
  distanceMeters: number,
  routeLengthMeters: number,
): PlacedPoint | null {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) return null;
  if (!Number.isFinite(routeLengthMeters) || routeLengthMeters <= 0) return null;
  if (distanceMeters > routeLengthMeters) return null;

  const target = (distanceMeters / routeLengthMeters) * ruler.polylineLengthMeters;

  for (let i = 1; i < ruler.cumulative.length; i++) {
    const start = ruler.cumulative[i - 1];
    const end = ruler.cumulative[i];
    const from = ruler.points[i - 1];
    const to = ruler.points[i];
    if (start === undefined || end === undefined || !from || !to) continue;
    if (target > end && i < ruler.cumulative.length - 1) continue;

    const span = end - start;
    const fraction = span > 0 ? Math.min(1, Math.max(0, (target - start) / span)) : 0;
    return {
      latitude: from.latitude + (to.latitude - from.latitude) * fraction,
      longitude: from.longitude + (to.longitude - from.longitude) * fraction,
      headingDegrees: bearingDegrees(
        { lat: from.latitude, lon: from.longitude },
        { lat: to.latitude, lon: to.longitude },
      ),
    };
  }
  return null;
}
