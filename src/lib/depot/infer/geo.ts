import type { DepotBusRow } from '@/models/depotLive';
import { haversineKm } from '@/lib/simulation/seededRandom';
import { METRES_PER_KM } from '@/lib/depot/units';

/**
 * Geometry for depot inference. The great-circle distance is the app's existing
 * `haversineKm`, re-exported so depot code has one import; only the local
 * metre projection yard clustering needs is new.
 */
export { haversineKm };

/** Metres per degree of latitude on the mean-radius sphere haversineKm uses. */
const METRES_PER_DEGREE = (Math.PI / 180) * 6371 * METRES_PER_KM;

/** A row whose position can be trusted as a place. */
export type PositionedRow = DepotBusRow & {
  readonly latitude: number;
  readonly longitude: number;
};

/**
 * True when the row carries a real position: both coordinates present and
 * finite, and not (0, 0). Devices report (0, 0) when they have no fix, so it
 * is a default, not a place; treating it as one would put a bus thousands of
 * km "away" and fabricate a departure.
 */
export function hasUsablePosition(row: DepotBusRow): row is PositionedRow {
  return isUsablePosition(row);
}

/** The same rule for anything carrying coordinates, narrowing both to numbers. */
export function isUsablePosition<
  T extends { readonly latitude: number | null; readonly longitude: number | null },
>(point: T): point is T & { readonly latitude: number; readonly longitude: number } {
  const { latitude, longitude } = point;
  if (latitude === null || longitude === null) return false;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  return !(latitude === 0 && longitude === 0);
}

export interface PointM {
  readonly x: number;
  readonly y: number;
}

/** Great-circle distance in metres. */
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return haversineKm(lat1, lng1, lat2, lng2) * METRES_PER_KM;
}

/** Project to metres east/north of an origin. Accurate to well under 1% across a city. */
export function toMetres(lat: number, lng: number, originLat: number, originLng: number): PointM {
  const cosLat = Math.cos((originLat * Math.PI) / 180);
  return {
    x: (lng - originLng) * cosLat * METRES_PER_DEGREE,
    y: (lat - originLat) * METRES_PER_DEGREE,
  };
}

/** Inverse of `toMetres`. */
export function fromMetres(
  point: PointM,
  originLat: number,
  originLng: number,
): { readonly lat: number; readonly lng: number } {
  const cosLat = Math.cos((originLat * Math.PI) / 180);
  return {
    lat: originLat + point.y / METRES_PER_DEGREE,
    lng: originLng + point.x / (cosLat * METRES_PER_DEGREE),
  };
}

/** A position prepared for many short-range distance checks. */
export interface NearPoint {
  readonly lat: number;
  readonly lng: number;
  /** Cosine of the latitude: how far a degree of longitude shrinks there. */
  readonly cosLat: number;
}

export function nearPoint(lat: number, lng: number): NearPoint {
  return { lat, lng, cosLat: Math.cos((lat * Math.PI) / 180) };
}

/**
 * Metres between two points on the flat plane through them. Within 0.1% of the
 * great-circle distance up to a few kilometres, which is all yard clustering
 * asks of it (longer distances only need to read as long), and cheap enough to
 * compare every pair of a depot's buses. It uses no shared origin or grid, so
 * moving every point by the same offset leaves every distance as it was.
 */
export function nearDistanceM(a: NearPoint, b: NearPoint): number {
  const north = (a.lat - b.lat) * METRES_PER_DEGREE;
  const east = (a.lng - b.lng) * METRES_PER_DEGREE * (a.cosLat + b.cosLat) * 0.5;
  return Math.sqrt(north * north + east * east);
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
