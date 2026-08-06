// Pure geometry helpers used for map matching: haversine distance/bearing,
// and projecting a GPS fix onto a route-direction polyline to get
// distance-along-route (s) and perpendicular offset. No PostGIS/DB
// dependency, so it is unit-testable in isolation and reusable regardless
// of how the caller sourced the polyline (PostGIS ST_AsGeoJSON, a cached
// in-memory shape, a test fixture, ...).

import type { LatLng } from "./types.js";

const EARTH_RADIUS_METERS = 6371000;
const METERS_PER_DEGREE_LAT = 111320;

export function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function toDegrees(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function haversineDistanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearingDegrees(a: LatLng, b: LatLng): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLon = toRadians(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

/** Smallest angle between two compass bearings, in [0, 180]. */
export function angularDifferenceDegrees(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

export function lineStringLengthMeters(points: readonly LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineDistanceMeters(points[i - 1]!, points[i]!);
  }
  return total;
}

export interface ProjectionResult {
  distanceAlongLineMeters: number;
  perpendicularDistanceMeters: number;
  segmentHeadingDegrees: number;
  segmentIndex: number;
}

/**
 * Projects `point` onto the polyline `points`, returning the closest
 * segment's cumulative distance-along-line, perpendicular offset, and
 * local heading. Each segment is projected in a local equirectangular
 * frame (accurate at bus-route segment scale - tens to a few hundred
 * metres) but segment lengths and the final cumulative distance are
 * measured with haversine, so results stay correct in metres regardless
 * of latitude.
 */
export function projectPointOntoLineString(
  point: LatLng,
  points: readonly LatLng[]
): ProjectionResult {
  if (points.length < 2) {
    throw new Error("projectPointOntoLineString requires at least 2 points");
  }

  let best: ProjectionResult | null = null;
  let cumulative = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const segStart = points[i]!;
    const segEnd = points[i + 1]!;
    const segLength = haversineDistanceMeters(segStart, segEnd);
    const { fraction, perpendicularDistanceMeters } = projectOntoSegment(
      point,
      segStart,
      segEnd
    );
    const clampedFraction = clamp(fraction, 0, 1);
    const distanceAlongLineMeters = cumulative + clampedFraction * segLength;
    const segmentHeadingDegrees = bearingDegrees(segStart, segEnd);

    if (!best || perpendicularDistanceMeters < best.perpendicularDistanceMeters) {
      best = {
        distanceAlongLineMeters,
        perpendicularDistanceMeters,
        segmentHeadingDegrees,
        segmentIndex: i,
      };
    }
    cumulative += segLength;
  }

  return best!;
}

function projectOntoSegment(
  point: LatLng,
  segStart: LatLng,
  segEnd: LatLng
): { fraction: number; perpendicularDistanceMeters: number } {
  const latRad = toRadians(segStart.lat);
  const metersPerDegLon = METERS_PER_DEGREE_LAT * Math.cos(latRad);

  const toXY = (p: LatLng) => ({
    x: (p.lon - segStart.lon) * metersPerDegLon,
    y: (p.lat - segStart.lat) * METERS_PER_DEGREE_LAT,
  });

  const end = toXY(segEnd);
  const p = toXY(point);

  const segLenSq = end.x * end.x + end.y * end.y;
  if (segLenSq < 1e-9) {
    return { fraction: 0, perpendicularDistanceMeters: haversineDistanceMeters(point, segStart) };
  }

  const fraction = (p.x * end.x + p.y * end.y) / segLenSq;
  const clampedFraction = clamp(fraction, 0, 1);
  const projX = clampedFraction * end.x;
  const projY = clampedFraction * end.y;
  const dx = p.x - projX;
  const dy = p.y - projY;

  return { fraction, perpendicularDistanceMeters: Math.sqrt(dx * dx + dy * dy) };
}

/** Wraps a distance into [0, total) - used for loop route-directions. */
export function wrapDistance(s: number, total: number): number {
  if (total <= 0) return 0;
  const wrapped = s % total;
  return wrapped < 0 ? wrapped + total : wrapped;
}

/**
 * Re-expresses `measuredS` in the same "lap" as `referenceS` (which may
 * have grown past `total` through monotonic accumulation across laps) so a
 * terminal wrap-around reads as a small forward step to a Kalman filter
 * instead of a huge, physically-impossible jump. Only meaningful for loop
 * route-directions.
 */
export function unwrapLoopMeasurement(
  measuredS: number,
  referenceS: number,
  total: number
): number {
  if (total <= 0) return measuredS;
  const referenceLap = Math.floor(referenceS / total);
  let closest = measuredS + referenceLap * total;
  for (const lap of [referenceLap - 1, referenceLap + 1]) {
    const candidate = measuredS + lap * total;
    if (Math.abs(candidate - referenceS) < Math.abs(closest - referenceS)) {
      closest = candidate;
    }
  }
  return closest;
}
