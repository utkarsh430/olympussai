// Pure geometry for the network seeder: haversine distance, the cumulative
// running sum stored on route_direction_stops, and LineString construction /
// validation for route_shapes.geom.
//
// No PostGIS, no DB, no I/O — every function here is unit-testable in
// isolation (tests/seed/geometry.test.ts).
//
// WHY A JS HAVERSINE RUNNING SUM AND NOT ST_LineLocatePoint * total:
// upstream publishes no polyline at all, so a route-direction's shape IS its
// ordered stop coordinates — the vertices and the stops are the same points.
// A running haversine sum over those vertices therefore agrees with
// total_distance_meters by construction, exactly. That matters because
// src/state-estimation/estimator.ts clamps smoothed distance to
// [0, totalDistanceMeters] and findNearestStop compares against
// route_direction_stops.cumulative_distance_meters: any drift between the two
// silently misclassifies stop state. persist.ts cross-checks the stored total
// against ST_Length(geom) once per direction and warns above 1% drift.

/**
 * IUGG mean Earth radius. Deliberately more precise than
 * src/state-estimation/geometry.ts's 6371000 — that module measures GPS-fix
 * projections where 1.4e-6 relative error is noise, whereas these numbers are
 * persisted once and then compared against PostGIS's own geodesic ST_Length.
 */
export const EARTH_RADIUS_METERS = 6371008.8;

/** Reject a whole route-direction longer than this. Longest UPSRTC runs are ~1000 km. */
export const MAX_TOTAL_DISTANCE_METERS = 2_000_000;
/** Reject a whole route-direction with any single stop-to-stop leg longer than this. */
export const MAX_LEG_DISTANCE_METERS = 200_000;

/**
 * Detour above which an interior stop is treated as a mis-surveyed coordinate
 * rather than a real diversion. See findCoordinateSpikes.
 */
export const MAX_STOP_DETOUR_METERS = 25_000;

export interface LatLng {
  lat: number;
  lon: number;
}

export function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Running haversine sum, one entry per input point. cumulative[0] is always 0
 * and the array is monotonically non-decreasing, which is what
 * route_direction_stops.cumulative_distance_meters (check >= 0) requires.
 * Two stops sharing a coordinate contribute a 0-length leg rather than being
 * collapsed — they are still two distinct stops at two distinct sequences.
 */
export function cumulativeDistancesMeters(points: readonly LatLng[]): number[] {
  const cumulative: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length; i += 1) {
    if (i > 0) total += haversineMeters(points[i - 1]!, points[i]!);
    cumulative.push(total);
  }
  return cumulative;
}

/** Longest single leg between consecutive points, in meters. 0 for < 2 points. */
export function maxLegMeters(points: readonly LatLng[]): number {
  let max = 0;
  for (let i = 1; i < points.length; i += 1) {
    const leg = haversineMeters(points[i - 1]!, points[i]!);
    if (leg > max) max = leg;
  }
  return max;
}

/**
 * Drop points identical to their immediate predecessor.
 *
 * Only ADJACENT duplicates: a genuine loop revisiting a coordinate later in the
 * run is a real vertex and must survive, or the polyline would be cut short.
 */
export function dedupeAdjacent(points: readonly LatLng[]): LatLng[] {
  const out: LatLng[] = [];
  for (const point of points) {
    const previous = out[out.length - 1];
    if (previous && previous.lat === point.lat && previous.lon === point.lon) continue;
    out.push(point);
  }
  return out;
}

/** Number of distinct coordinates in the list (not just adjacent-distinct). */
export function distinctVertexCount(points: readonly LatLng[]): number {
  return new Set(points.map((p) => `${p.lat},${p.lon}`)).size;
}

export interface CoordinateSpike {
  /** Index into the ORIGINAL input array. */
  index: number;
  /** Extra distance this point adds versus going straight from prev to next. */
  detourMeters: number;
}

/**
 * Find interior points whose coordinate is a survey error rather than a stop.
 *
 * WHY THIS EXISTS ON TOP OF buildShape's LIMITS. The total/max-leg limits catch
 * a coordinate that landed in another state. They do not catch the far more
 * common case, measured on live data: line 2046 (KAISERBAGH -> TIKAIT NAGAR,
 * genuinely ~130 km) lists MOHAMMADPUR at 26.759/82.052, about 97 km off the
 * corridor. Both of its legs are ~95 km — under MAX_LEG_DISTANCE_METERS — and
 * the resulting 300 km total is under MAX_TOTAL_DISTANCE_METERS, so the whole
 * direction is accepted with a 190 km phantom spur in the middle of it. That is
 * worse than a rejection: src/state-estimation/estimator.ts clamps smoothed
 * distance to [0, total] and findNearestStop compares cumulative distances, so
 * every vehicle past that stop is mis-classified with no error anywhere.
 *
 * A point is a spike when the round trip out to it and back
 * (prev->cur->next) exceeds going straight on (prev->next) by more than
 * `maxDetourMeters`. That is scale-free — it fires on a 97 km excursion and
 * never on a real 2 km loop through a village — and it is the smallest
 * possible repair: one stop is dropped and logged, the direction survives.
 *
 * Endpoints are excluded: with only one neighbour there is no bypass distance
 * to compare against, and a genuinely long first/last leg is normal on
 * interurban runs. Terminal outliers stay the max-leg rule's job.
 *
 * Iterative, because removing one spike changes its neighbours' geometry.
 * Returns indices into the original array, ascending.
 */
export function findCoordinateSpikes(
  points: readonly LatLng[],
  maxDetourMeters: number = MAX_STOP_DETOUR_METERS,
): CoordinateSpike[] {
  if (maxDetourMeters <= 0 || points.length < 3) return [];

  const surviving = points.map((point, index) => ({ point, index }));
  const spikes: CoordinateSpike[] = [];

  // Each pass removes at most one point, so points.length passes is a hard
  // upper bound on the loop — no unbounded iteration on adversarial input.
  for (let pass = 0; pass < points.length; pass += 1) {
    let worst: { position: number; detourMeters: number } | null = null;

    for (let position = 1; position < surviving.length - 1; position += 1) {
      const previous = surviving[position - 1]!.point;
      const current = surviving[position]!.point;
      const next = surviving[position + 1]!.point;
      const detour =
        haversineMeters(previous, current) +
        haversineMeters(current, next) -
        haversineMeters(previous, next);
      if (detour > maxDetourMeters && (worst === null || detour > worst.detourMeters)) {
        worst = { position, detourMeters: detour };
      }
    }

    if (!worst) break;
    const [removed] = surviving.splice(worst.position, 1);
    spikes.push({ index: removed!.index, detourMeters: worst.detourMeters });
  }

  return spikes.sort((a, b) => a.index - b.index);
}

export type ShapeRejectionReason =
  | 'too_few_stops'
  | 'too_few_distinct_vertices'
  | 'zero_length'
  | 'total_distance_exceeds_limit'
  | 'leg_distance_exceeds_limit';

export interface ShapeBuildSuccess {
  ok: true;
  /** Adjacent-deduped vertices, in order. Cast to geography(LineString,4326). */
  vertices: LatLng[];
  /** One entry per INPUT point (not per vertex) — pairs with the stop list. */
  cumulativeDistancesMeters: number[];
  totalDistanceMeters: number;
  maxLegMeters: number;
}

export interface ShapeBuildFailure {
  ok: false;
  reason: ShapeRejectionReason;
  detail: string;
}

export type ShapeBuildResult = ShapeBuildSuccess | ShapeBuildFailure;

/**
 * Build and validate a route-direction shape from its ordered stop coordinates.
 *
 * Rejects the WHOLE direction (never a silent partial shape) unless:
 *   * at least 2 distinct vertices — ST_MakeLine over one point yields a POINT
 *     and the ::geography(LineString,4326) cast then fails at insert time;
 *   * total_distance_meters > 0 — the column has `check (> 0)`;
 *   * total < MAX_TOTAL_DISTANCE_METERS AND max leg < MAX_LEG_DISTANCE_METERS.
 *     That pair is the signature of a residual bad coordinate that passed the
 *     0/0 filter (e.g. a transposed lat/lon landing in another state): the
 *     total alone can look plausible on a genuinely long inter-city run, and a
 *     single long leg alone is legal on a rural route, but both together are
 *     not.
 */
export function buildShape(points: readonly LatLng[]): ShapeBuildResult {
  if (points.length < 2) {
    return { ok: false, reason: 'too_few_stops', detail: `${points.length} stop(s) with a coordinate` };
  }

  const vertices = dedupeAdjacent(points);
  if (distinctVertexCount(vertices) < 2) {
    return {
      ok: false,
      reason: 'too_few_distinct_vertices',
      detail: `${distinctVertexCount(vertices)} distinct vertex/vertices after adjacent de-duplication`,
    };
  }

  const cumulative = cumulativeDistancesMeters(points);
  const total = cumulative[cumulative.length - 1] ?? 0;
  const maxLeg = maxLegMeters(vertices);

  if (!(total > 0)) {
    return { ok: false, reason: 'zero_length', detail: 'total distance is 0 m' };
  }
  if (total >= MAX_TOTAL_DISTANCE_METERS) {
    return {
      ok: false,
      reason: 'total_distance_exceeds_limit',
      detail: `${Math.round(total)} m >= ${MAX_TOTAL_DISTANCE_METERS} m`,
    };
  }
  if (maxLeg >= MAX_LEG_DISTANCE_METERS) {
    return {
      ok: false,
      reason: 'leg_distance_exceeds_limit',
      detail: `longest leg ${Math.round(maxLeg)} m >= ${MAX_LEG_DISTANCE_METERS} m`,
    };
  }

  return {
    ok: true,
    vertices,
    cumulativeDistancesMeters: cumulative,
    totalDistanceMeters: total,
    maxLegMeters: maxLeg,
  };
}

/**
 * WKT for the vertices, e.g. `LINESTRING(77.31 28.64,77.40 28.60)`.
 *
 * WKT is lon-lat ordered (X then Y) — the single most common way to get a
 * PostGIS seed silently wrong. Persisted via
 * `ST_GeomFromText($1, 4326)::geography`.
 */
export function toLineStringWkt(vertices: readonly LatLng[]): string {
  const body = vertices.map((v) => `${v.lon} ${v.lat}`).join(',');
  return `LINESTRING(${body})`;
}
