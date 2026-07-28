/**
 * Polyline interpolation along a route, by cumulative distance.
 *
 * Placing a bus at "60% of the way along the route" must mean 60% of the
 * *distance travelled*, not 60% of the way between the first and last
 * coordinate — a corridor with unevenly spaced stops would otherwise bunch its
 * own markers wherever the survey points happen to be dense.
 *
 * Kept free of React and of Google Maps types so it can be unit tested and
 * reused anywhere a position along a path is needed.
 */

import { haversineKm } from '@/lib/simulation/seededRandom';

export interface RoutePoint {
  latitude: number;
  longitude: number;
}

export interface RouteStop extends RoutePoint {
  name: string;
  /** Stop sequence as published by the UPSRTC schedule feed. */
  sequence: number;
}

export interface RouteGeometry {
  points: readonly RoutePoint[];
  /** Distance from the origin to each point, in kilometres. */
  cumulativeKm: readonly number[];
  totalKm: number;
}

export interface InterpolatedPosition extends RoutePoint {
  /** Direction of travel at this position, degrees clockwise from north. */
  bearingDegrees: number;
}

/** Pre-compute the cumulative distance table for a path. */
export function buildRouteGeometry(points: readonly RoutePoint[]): RouteGeometry {
  if (points.length < 2) {
    throw new Error('buildRouteGeometry requires at least two points');
  }

  const cumulativeKm: number[] = [0];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1] as RoutePoint;
    const current = points[index] as RoutePoint;
    const segment = haversineKm(
      previous.latitude,
      previous.longitude,
      current.latitude,
      current.longitude,
    );
    cumulativeKm.push((cumulativeKm[index - 1] as number) + segment);
  }

  return {
    points,
    cumulativeKm,
    totalKm: cumulativeKm[cumulativeKm.length - 1] as number,
  };
}

/** Initial bearing from one coordinate to another, in degrees from north. */
export function bearingBetween(from: RoutePoint, to: RoutePoint): number {
  const toRad = (value: number): number => (value * Math.PI) / 180;
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);
  const dLng = toRad(to.longitude - from.longitude);

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

/**
 * Position at `fraction` of the route's total distance, clamped to the path.
 * Linear within a segment, which is correct for the straight segments a stop
 * sequence describes.
 */
export function pointAtFraction(geometry: RouteGeometry, fraction: number): InterpolatedPosition {
  const { points, cumulativeKm, totalKm } = geometry;
  const clamped = Math.min(1, Math.max(0, fraction));
  const targetKm = clamped * totalKm;

  // Find the segment containing targetKm. Linear scan: a corridor has a handful
  // of stops, and this runs a few times per animation frame at most.
  let segment = 1;
  while (segment < cumulativeKm.length - 1 && (cumulativeKm[segment] as number) < targetKm) {
    segment += 1;
  }

  const start = points[segment - 1] as RoutePoint;
  const end = points[segment] as RoutePoint;
  const startKm = cumulativeKm[segment - 1] as number;
  const endKm = cumulativeKm[segment] as number;
  const span = endKm - startKm;
  const ratio = span > 0 ? (targetKm - startKm) / span : 0;

  return {
    latitude: start.latitude + (end.latitude - start.latitude) * ratio,
    longitude: start.longitude + (end.longitude - start.longitude) * ratio,
    bearingDegrees: bearingBetween(start, end),
  };
}

/** Fraction of the route at which a given path point sits. */
export function fractionOfPoint(geometry: RouteGeometry, index: number): number {
  if (geometry.totalKm <= 0) return 0;
  const distance = geometry.cumulativeKm[index];
  if (distance === undefined) return 0;
  return distance / geometry.totalKm;
}
