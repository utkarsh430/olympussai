// Process-local cache of the network geometry the map matcher needs:
// every active route-direction's shape, its stops, and a coarse spatial
// index over the shape vertices.
//
// Why this exists
// ---------------
// processPositionEvent() used to call loadActiveRouteDirectionShapes() on
// EVERY event - a full `route_directions join route_shapes` scan with
// ST_AsGeoJSON plus a JSON.parse of every polyline - followed by
// loadRouteDirectionStops() for all active directions. At ~1,020 active
// route-directions and ~665 vehicles per 30 s poll, that is 665 full-table
// scans per cycle. This is the wall that has to come down before ingestion
// can run at fleet scale.
//
// Three properties carry the design:
//
//  1. SINGLE-FLIGHT. The in-flight promise is held in a field and shared.
//     Without it, a 665-event batch arriving on a cold cache fires 665
//     concurrent full-table scans - strictly worse than the uncached code
//     it replaces. This is the single most important detail in the file.
//
//  2. STALE-WHILE-REVALIDATE. Past the TTL we serve the stale snapshot and
//     kick off a refresh in the background. Geometry only changes when an
//     operator re-runs the seeder, so a 15-minute-old shape is harmless; a
//     665-event stall on a synchronous reload is not.
//
//  3. SPATIAL PREFILTER. A 0.05-degree grid (~5.5 km cells) buckets every
//     shape vertex plus its 8 neighbours. Unfiltered, one poll cycle costs
//     1,020 shapes x ~21 vertices x 665 events ~= 14M segment projections,
//     which is 1-2 s of blocking CPU in a single-threaded Express process
//     every cycle. With the prefilter it is ~150k.
//
// Deliberately NOT folded into state/store.ts: that store is
// rehydrate-once / wholesale-replace and is shared with the MPC solver.
// This one is TTL'd, self-refreshing and read on the hot path; mixing the
// two lifecycles would couple them badly.

import { logger } from '../lib/logger.js';
import type { StateEstimationRepository } from './repository.js';
import type { CompletedStopVisit } from './stopVisit.js';
import type {
  LatLng,
  PriorVehicleState,
  RouteDirectionShape,
  RouteDirectionStopPoint,
  VehicleStateEstimate,
} from './types.js';

/**
 * Grid cell size in degrees. 0.05 deg is ~5.5 km of latitude (and ~5.4 km
 * of longitude at UP's latitude), comfortably larger than
 * CANDIDATE_RADIUS_METERS so a lookup never needs more than the 3x3 block
 * this index already materialises.
 */
export const GRID_CELL_DEGREES = 0.05;

/**
 * Radius used to prefilter candidate shapes around a fix.
 *
 * 2 km is deliberately >> the estimator's own 75 m off-route threshold
 * (OFF_ROUTE_PERPENDICULAR_METERS in confidence.ts). Any shape the
 * unfiltered path could have chosen is within 75 m of the fix and is
 * therefore always inside this radius, so the prefilter can never change a
 * decision the unfiltered path would have made - it only removes shapes
 * that were destined to be scored off_route anyway. tests/cache.test.ts
 * asserts exactly that equivalence.
 */
export const CANDIDATE_RADIUS_METERS = 2000;

export interface NetworkGeometrySnapshot {
  shapes: RouteDirectionShape[];
  stopsByDirection: Map<string, RouteDirectionStopPoint[]>;
  /** "<latCell>:<lonCell>" -> routeDirectionIds whose shape touches that cell or a neighbour. */
  grid: Map<string, string[]>;
  loadedAt: number;
  version: number;
}

export interface NetworkGeometryCacheStats {
  version: number;
  shapeCount: number;
  loadedAt: string | null;
}

function cellKey(latCell: number, lonCell: number): string {
  return `${latCell}:${lonCell}`;
}

function cellIndex(value: number): number {
  return Math.floor(value / GRID_CELL_DEGREES);
}

/**
 * Walks a shape emitting its vertices plus enough interpolated points that
 * consecutive samples never differ by more than one cell in either axis.
 *
 * Vertices alone are not sufficient: a route stored as two vertices 40 km
 * apart passes through cells that contain no vertex at all, and a fix
 * sitting on that segment would miss the shape entirely. Densifying is what
 * turns "near a vertex" into "near the line".
 */
function forEachSampledPoint(points: readonly LatLng[], visit: (p: LatLng) => void): void {
  const first = points[0];
  if (!first) return;
  visit(first);

  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1]!;
    const to = points[i]!;
    const steps = Math.max(
      1,
      Math.ceil(Math.abs(to.lat - from.lat) / GRID_CELL_DEGREES),
      Math.ceil(Math.abs(to.lon - from.lon) / GRID_CELL_DEGREES),
    );
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      visit({ lat: from.lat + (to.lat - from.lat) * t, lon: from.lon + (to.lon - from.lon) * t });
    }
  }
}

/**
 * Buckets each shape into every grid cell its (densified) geometry falls
 * in, PLUS the 8 neighbouring cells. The halo is what makes a plain
 * single-cell lookup correct: a fix sitting 10 m inside cell C can be
 * within metres of a shape whose geometry is in the cell next door, and
 * without the halo that shape would be invisible to the prefilter.
 */
export function buildGrid(shapes: readonly RouteDirectionShape[]): Map<string, string[]> {
  const grid = new Map<string, string[]>();

  for (const shape of shapes) {
    // Per-shape dedupe: a shape usually touches only a handful of cells,
    // and we must not push the same id into one bucket once per vertex.
    const claimed = new Set<string>();
    forEachSampledPoint(shape.points, (point) => {
      const latCell = cellIndex(point.lat);
      const lonCell = cellIndex(point.lon);
      for (let dLat = -1; dLat <= 1; dLat++) {
        for (let dLon = -1; dLon <= 1; dLon++) {
          claimed.add(cellKey(latCell + dLat, lonCell + dLon));
        }
      }
    });
    for (const key of claimed) {
      const bucket = grid.get(key);
      if (bucket) bucket.push(shape.routeDirectionId);
      else grid.set(key, [shape.routeDirectionId]);
    }
  }

  return grid;
}

/**
 * Shapes plausibly within `radiusMeters` of `point`, read off the grid.
 * A superset by construction (cell granularity is coarser than the
 * radius) - the caller still runs exact projection over whatever comes
 * back. Returning a superset is the only safe direction to err in.
 */
export function candidateShapesNear(
  snapshot: NetworkGeometrySnapshot,
  point: LatLng,
): RouteDirectionShape[] {
  const ids = snapshot.grid.get(cellKey(cellIndex(point.lat), cellIndex(point.lon)));
  if (!ids || ids.length === 0) return [];
  const wanted = new Set(ids);
  return snapshot.shapes.filter((s) => wanted.has(s.routeDirectionId));
}

export class NetworkGeometryCache {
  private snapshot: NetworkGeometrySnapshot | null = null;
  /** Non-null exactly while a load is in flight - this field IS the single-flight guard. */
  private inFlight: Promise<NetworkGeometrySnapshot> | null = null;
  private version = 0;
  private refreshFailures = 0;

  constructor(
    private readonly repository: StateEstimationRepository,
    private readonly ttlMs: number = 15 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  get stats(): NetworkGeometryCacheStats {
    return {
      version: this.snapshot?.version ?? 0,
      shapeCount: this.snapshot?.shapes.length ?? 0,
      loadedAt: this.snapshot ? new Date(this.snapshot.loadedAt).toISOString() : null,
    };
  }

  /**
   * Current snapshot. Cold -> awaits a load (shared by every concurrent
   * caller). Warm -> returns immediately. Warm-but-expired -> returns the
   * stale snapshot and refreshes in the background.
   */
  async get(): Promise<NetworkGeometrySnapshot> {
    const current = this.snapshot;

    if (current && this.now() - current.loadedAt < this.ttlMs) {
      return current;
    }

    if (current) {
      // Stale-while-revalidate: hand back the stale snapshot now, refresh
      // behind it. A background failure is logged and swallowed - the
      // caller already has a usable answer, and throwing here would fail
      // an ingest for a reason that has nothing to do with its own event.
      void this.refresh().catch(() => undefined);
      return current;
    }

    return this.refresh();
  }

  /**
   * Drops the cached snapshot so the next get() reloads. Used by
   * POST /v1/admin/geometry/refresh after a seeder run - the TTL is only
   * the backstop, explicit invalidation is the intended path.
   */
  invalidate(): void {
    this.snapshot = null;
  }

  /** Loads eagerly (or joins an in-flight load). Used to warm the cache off the hot path. */
  async warm(): Promise<NetworkGeometrySnapshot> {
    return this.refresh();
  }

  private refresh(): Promise<NetworkGeometrySnapshot> {
    // Single-flight. Every concurrent caller receives THIS promise, so a
    // 665-event batch on a cold cache performs exactly one DB round trip.
    if (this.inFlight) return this.inFlight;

    const load = this.load()
      .then((snapshot) => {
        this.snapshot = snapshot;
        this.refreshFailures = 0;
        return snapshot;
      })
      .catch((error: unknown) => {
        this.refreshFailures += 1;
        logger.error(
          {
            error: error instanceof Error ? error.message : String(error),
            consecutiveFailures: this.refreshFailures,
          },
          'network geometry cache refresh failed',
        );
        throw error;
      })
      .finally(() => {
        this.inFlight = null;
      });

    this.inFlight = load;
    return load;
  }

  private async load(): Promise<NetworkGeometrySnapshot> {
    const startedAt = this.now();
    const shapes = await this.repository.loadActiveRouteDirectionShapes();
    const stopsByDirection = await this.repository.loadRouteDirectionStops(
      shapes.map((s) => s.routeDirectionId),
    );
    const grid = buildGrid(shapes);
    this.version += 1;

    logger.info(
      {
        version: this.version,
        shapeCount: shapes.length,
        gridCells: grid.size,
        durationMs: this.now() - startedAt,
      },
      'network geometry cache loaded',
    );

    return { shapes, stopsByDirection, grid, loadedAt: this.now(), version: this.version };
  }
}

/**
 * Decorates a StateEstimationRepository so the geometry reads
 * (loadActiveRouteDirectionShapes / loadRouteDirectionStops) come from a
 * NetworkGeometryCache snapshot, and adds the spatial prefilter.
 *
 * A decorator rather than a flag on PgStateEstimationRepository, because
 * the cache is constructed OVER a repository - having the same object be
 * both the cache's data source and its consumer would make load() re-enter
 * itself the first time it fetched stops.
 *
 * The per-vehicle lookups (loadPriorVehicleState, loadActiveHold,
 * resolveCurrentTrip) are deliberately passed straight through uncached:
 * they are indexed single-row reads, and loadActiveHold in particular gates
 * the `held_by_controller` stop state - serving that from a cache would let
 * a controller's hold take minutes to become visible.
 */
export class CachedGeometryRepository implements StateEstimationRepository {
  constructor(
    private readonly base: StateEstimationRepository,
    private readonly cache: NetworkGeometryCache,
  ) {}

  async loadActiveRouteDirectionShapes(): Promise<RouteDirectionShape[]> {
    return (await this.cache.get()).shapes;
  }

  async loadRouteDirectionStops(
    routeDirectionIds: readonly string[],
  ): Promise<Map<string, RouteDirectionStopPoint[]>> {
    const snapshot = await this.cache.get();
    const result = new Map<string, RouteDirectionStopPoint[]>();
    for (const id of routeDirectionIds) {
      const stops = snapshot.stopsByDirection.get(id);
      if (stops) result.set(id, stops);
    }
    return result;
  }

  async loadCandidateShapesNear(point: LatLng, _radiusMeters: number): Promise<RouteDirectionShape[]> {
    return candidateShapesNear(await this.cache.get(), point);
  }

  async loadPriorVehicleState(vehicleId: string): Promise<PriorVehicleState | null> {
    return this.base.loadPriorVehicleState(vehicleId);
  }

  async loadActiveHold(vehicleId: string): Promise<boolean> {
    return this.base.loadActiveHold(vehicleId);
  }

  async resolveCurrentTrip(
    vehicleId: string,
    routeDirectionId: string,
    now: Date,
  ): Promise<string | null> {
    return this.base.resolveCurrentTrip(vehicleId, routeDirectionId, now);
  }

  async saveVehicleState(estimate: VehicleStateEstimate): Promise<boolean> {
    return this.base.saveVehicleState(estimate);
  }

  async rehydrateAll(): Promise<Map<string, PriorVehicleState>> {
    return this.base.rehydrateAll();
  }

  /**
   * Pass-through, and NOT cacheable in any form: it is the one write on this
   * interface that appends history rather than overwriting current state.
   * Omitting it here is what kept `stop_visits` empty in production - see the
   * note on StateEstimationRepository.recordStopVisit.
   */
  async recordStopVisit(visit: CompletedStopVisit): Promise<void> {
    return this.base.recordStopVisit(visit);
  }
}
