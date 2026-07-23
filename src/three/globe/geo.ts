/**
 * Pure geographic helpers for the golden globe (Phase 2, Stage 1).
 *
 * Deliberately framework-agnostic: no `three`, no `window`, no side effects.
 * Everything here is deterministic and unit-tested so the globe's geometry can
 * be reasoned about (and its orientation asserted) without a WebGL context.
 *
 * Coordinates follow GeoJSON order: `[lng, lat]` in degrees. The sphere mapping
 * below is chosen so that **longitude −90° (≈ the Americas) faces +Z (the
 * camera) with zero rotation** — see `latLngToVec3` and its tests.
 */

export const DEG2RAD = Math.PI / 180;

export type Vec3 = [number, number, number];

/** A closed GeoJSON ring: `[lng, lat]` pairs, first vertex repeated as last. */
export type Ring = ReadonlyArray<readonly [number, number]>;

/** A land polygon: exterior ring first, any remaining rings are holes. */
export interface LandPolygon {
  readonly rings: ReadonlyArray<Ring>;
  /** `[minLng, minLat, maxLng, maxLat]` of the exterior ring (fast reject). */
  readonly bbox: readonly [number, number, number, number];
}

/**
 * Convert a geographic coordinate to a point on a sphere of the given radius.
 *
 * Convention (verified in geo.test.ts):
 *   - lat  +90° → +Y (north pole), −90° → −Y (south pole)
 *   - lng  −90° → +Z (faces the camera) — the Americas
 *   - lng  +90° → −Z (away from camera) — East Asia
 *   - lng    0° → +X (Greenwich, screen right)
 */
export function latLngToVec3(lat: number, lng: number, radius = 1): Vec3 {
  const phi = (90 - lat) * DEG2RAD; // polar angle from +Y
  const theta = (lng + 180) * DEG2RAD; // azimuth
  const sinPhi = Math.sin(phi);
  return [
    -radius * sinPhi * Math.cos(theta),
    radius * Math.cos(phi),
    radius * sinPhi * Math.sin(theta),
  ];
}

/** Even-odd ray-cast test of a point against a single ring (lng/lat plane). */
function pointInRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    const xi = a[0];
    const yi = a[1];
    const xj = b[0];
    const yj = b[1];
    const intersects =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** True when `[lng, lat]` is inside the polygon's exterior and outside its holes. */
export function polygonContainsPoint(polygon: LandPolygon, lng: number, lat: number): boolean {
  const [minLng, minLat, maxLng, maxLat] = polygon.bbox;
  if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) return false;
  const rings = polygon.rings;
  const exterior = rings[0];
  if (!exterior || !pointInRing(lng, lat, exterior)) return false;
  for (let i = 1; i < rings.length; i++) {
    const hole = rings[i];
    if (hole && pointInRing(lng, lat, hole)) return false; // inside a hole → not land
  }
  return true;
}

/** True when `[lng, lat]` falls on any land polygon. */
export function landContainsPoint(
  polygons: ReadonlyArray<LandPolygon>,
  lng: number,
  lat: number,
): boolean {
  for (const p of polygons) {
    if (polygonContainsPoint(p, lng, lat)) return true;
  }
  return false;
}

export interface LandSampleOptions {
  /** Grid spacing in degrees at the equator. Smaller → denser. */
  stepDeg: number;
  /**
   * Lower bound on cos(lat) used to widen the longitude step toward the poles,
   * giving a roughly even surface distribution instead of pole clustering.
   */
  minCos?: number;
}

/**
 * Deterministically sample a lat/lng grid and keep the points that fall on
 * land. Longitude spacing is widened by 1/cos(lat) (clamped) so dots are spread
 * evenly over the sphere rather than bunching at the poles.
 *
 * Uses integer band/column counts (not floating-point accumulation) so the
 * result is bit-stable across runs — see the determinism tests.
 */
export function sampleLandGrid(
  polygons: ReadonlyArray<LandPolygon>,
  opts: LandSampleOptions,
): Array<[number, number]> {
  const step = opts.stepDeg;
  const minCos = opts.minCos ?? 0.12;
  const out: Array<[number, number]> = [];
  const latBands = Math.max(1, Math.floor(180 / step));
  for (let i = 0; i < latBands; i++) {
    const lat = -90 + (i + 0.5) * (180 / latBands);
    const cos = Math.max(Math.cos(lat * DEG2RAD), minCos);
    const lngCols = Math.max(1, Math.round(360 / (step / cos)));
    for (let j = 0; j < lngCols; j++) {
      const lng = -180 + j * (360 / lngCols);
      if (landContainsPoint(polygons, lng, lat)) out.push([lng, lat]);
    }
  }
  return out;
}

/** Flatten `[lng, lat]` samples into a packed XYZ Float32Array on the sphere. */
export function landPointsToPositions(
  points: ReadonlyArray<readonly [number, number]>,
  radius: number,
): Float32Array {
  const arr = new Float32Array(points.length * 3);
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const [x, y, z] = latLngToVec3(p[1], p[0], radius);
    arr[i * 3] = x;
    arr[i * 3 + 1] = y;
    arr[i * 3 + 2] = z;
  }
  return arr;
}

export interface GraticuleOptions {
  /** Number of latitude circles (poles excluded). */
  parallels: number;
  /** Number of longitude meridians (evenly spaced around the equator). */
  meridians: number;
  /** Segments per line — higher is smoother. */
  segments: number;
  /** Sphere radius the lines sit on. */
  radius: number;
}

/**
 * Build a lat/lng graticule as a packed XYZ Float32Array suitable for
 * `THREE.LineSegments` (consecutive vertex pairs form segments). Deterministic;
 * its length is `(parallels + meridians) * segments * 2 * 3`.
 */
export function buildGraticule(opts: GraticuleOptions): Float32Array {
  const { parallels, meridians, segments, radius } = opts;
  const total = (parallels + meridians) * segments;
  const arr = new Float32Array(total * 2 * 3);
  let o = 0;
  const push = (lat: number, lng: number) => {
    const [x, y, z] = latLngToVec3(lat, lng, radius);
    arr[o++] = x;
    arr[o++] = y;
    arr[o++] = z;
  };

  // Parallels: full latitude circles, excluding the poles.
  for (let k = 1; k <= parallels; k++) {
    const lat = -90 + k * (180 / (parallels + 1));
    for (let s = 0; s < segments; s++) {
      push(lat, -180 + s * (360 / segments));
      push(lat, -180 + (s + 1) * (360 / segments));
    }
  }

  // Meridians: pole-to-pole longitude lines.
  for (let m = 0; m < meridians; m++) {
    const lng = -180 + m * (360 / meridians);
    for (let s = 0; s < segments; s++) {
      push(-90 + s * (180 / segments), lng);
      push(-90 + (s + 1) * (180 / segments), lng);
    }
  }

  return arr;
}
