// NetworkGeometryCache: the two properties that decide whether the cache
// is an optimisation or a liability.
//
//  - SINGLE-FLIGHT. A cold cache hit by a 665-event poll batch must issue
//    ONE load, not 665. Without this the cache is strictly worse than the
//    uncached code it replaced.
//  - PREFILTER EQUIVALENCE. The 0.05-degree grid must never change a
//    map-match decision - only remove work. The radius (2 km) is far wider
//    than the estimator's 75 m off-route threshold precisely so that the
//    filtered and unfiltered paths cannot disagree.

import { describe, expect, it } from "vitest";
import {
  CachedGeometryRepository,
  NetworkGeometryCache,
  candidateShapesNear,
} from "../src/state-estimation/cache.js";
import { StateEstimationService } from "../src/state-estimation/service.js";
import { InMemoryStateEstimationRepository } from "../src/state-estimation/testing/inMemoryRepository.js";
import type {
  RouteDirectionShape,
  RouteDirectionStopPoint,
} from "../src/state-estimation/types.js";
import { ORIGIN, makeShape, offsetEastNorth, straightLinePoints } from "./helpers.js";

/**
 * Counts loads and lets a test hold the load open, so "did concurrent
 * callers share one load?" is observable rather than inferred from timing.
 */
class CountingRepository extends InMemoryStateEstimationRepository {
  shapeLoads = 0;
  stopLoads = 0;
  private gate: Promise<void> = Promise.resolve();

  /** Blocks every subsequent load until the returned function is called. */
  block(): () => void {
    let release!: () => void;
    this.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return release;
  }

  override async loadActiveRouteDirectionShapes(): Promise<RouteDirectionShape[]> {
    this.shapeLoads += 1;
    await this.gate;
    return super.loadActiveRouteDirectionShapes();
  }

  override async loadRouteDirectionStops(
    routeDirectionIds: readonly string[]
  ): Promise<Map<string, RouteDirectionStopPoint[]>> {
    this.stopLoads += 1;
    return super.loadRouteDirectionStops(routeDirectionIds);
  }
}

const nearShape = makeShape({
  routeDirectionId: "rd-near",
  points: straightLinePoints(ORIGIN, 2000, 250),
  totalDistanceMeters: 2000,
});

/** ~110 km north: far outside any grid cell the fix's 3x3 block covers. */
const farShape = makeShape({
  routeDirectionId: "rd-far",
  points: straightLinePoints(offsetEastNorth(ORIGIN, 0, 110_000), 2000, 250),
  totalDistanceMeters: 2000,
});

describe("NetworkGeometryCache single-flight", () => {
  it("collapses a burst of concurrent cold-cache reads into exactly one load", async () => {
    const repo = new CountingRepository([nearShape, farShape]);
    const cache = new NetworkGeometryCache(repo, 60_000);

    const release = repo.block();
    // Stand in for a poll batch arriving all at once on a cold cache.
    const inFlight = Array.from({ length: 665 }, () => cache.get());
    release();
    const snapshots = await Promise.all(inFlight);

    expect(repo.shapeLoads).toBe(1);
    expect(repo.stopLoads).toBe(1);
    // Every caller got the SAME object, not 665 equal-but-distinct ones -
    // that identity is what proves they shared a load rather than raced.
    for (const snapshot of snapshots) {
      expect(snapshot).toBe(snapshots[0]);
    }
  });

  it("serves a warm snapshot without touching the repository again", async () => {
    const repo = new CountingRepository([nearShape]);
    const cache = new NetworkGeometryCache(repo, 60_000);

    await cache.get();
    await cache.get();
    await cache.get();

    expect(repo.shapeLoads).toBe(1);
  });

  it("reloads after invalidate(), which is what POST /v1/admin/geometry/refresh relies on", async () => {
    const repo = new CountingRepository([nearShape]);
    const cache = new NetworkGeometryCache(repo, 60_000);

    const first = await cache.get();
    cache.invalidate();
    const second = await cache.get();

    expect(repo.shapeLoads).toBe(2);
    expect(second.version).toBe(first.version + 1);
  });

  it("serves the stale snapshot past the TTL and refreshes behind it, instead of stalling the caller", async () => {
    const repo = new CountingRepository([nearShape]);
    let clock = 1_000;
    const cache = new NetworkGeometryCache(repo, 10_000, () => clock);

    const first = await cache.get();
    clock += 20_000; // past the TTL

    const stale = await cache.get();
    // Same snapshot object: the expired read was served immediately.
    expect(stale).toBe(first);

    // ...and a refresh was kicked off behind it.
    await Promise.resolve();
    await Promise.resolve();
    expect(repo.shapeLoads).toBe(2);
  });

  it("does not cache a failure: a later get() retries instead of serving the rejection forever", async () => {
    const repo = new CountingRepository([nearShape]);
    const cache = new NetworkGeometryCache(repo, 60_000);
    const boom = new Error("network geometry unavailable");
    const original = repo.loadActiveRouteDirectionShapes.bind(repo);
    repo.loadActiveRouteDirectionShapes = () => Promise.reject(boom);

    await expect(cache.get()).rejects.toThrow("network geometry unavailable");

    repo.loadActiveRouteDirectionShapes = original;
    const snapshot = await cache.get();
    expect(snapshot.shapes).toHaveLength(1);
  });
});

describe("grid prefilter", () => {
  it("returns the nearby shape and drops the distant one", async () => {
    const repo = new CountingRepository([nearShape, farShape]);
    const cache = new NetworkGeometryCache(repo, 60_000);
    const snapshot = await cache.get();

    const fix = offsetEastNorth(ORIGIN, 1000, 20);
    const candidates = candidateShapesNear(snapshot, fix);

    expect(candidates.map((s) => s.routeDirectionId)).toEqual(["rd-near"]);
  });

  it("finds a shape from a point BETWEEN two distant vertices (densification, not just vertex proximity)", async () => {
    // Two vertices 40 km apart: the midpoint lies in cells that contain no
    // vertex at all, so a vertex-only index would miss this shape entirely.
    const sparse = makeShape({
      routeDirectionId: "rd-sparse",
      points: [ORIGIN, offsetEastNorth(ORIGIN, 40_000, 0)],
      totalDistanceMeters: 40_000,
    });
    const repo = new CountingRepository([sparse]);
    const snapshot = await new NetworkGeometryCache(repo, 60_000).get();

    const midpoint = offsetEastNorth(ORIGIN, 20_000, 0);
    expect(candidateShapesNear(snapshot, midpoint).map((s) => s.routeDirectionId)).toEqual([
      "rd-sparse",
    ]);
  });

  it("produces an IDENTICAL estimate to the unfiltered path (the prefilter must remove work, never change a decision)", async () => {
    const shapes = [nearShape, farShape];
    const fix = offsetEastNorth(ORIGIN, 800, 15);
    const event = {
      vehicleId: "veh-1",
      lat: fix.lat,
      lon: fix.lon,
      headingDegrees: 90,
      speedKmph: 24,
      observedAt: "2026-08-05T08:00:00.000Z",
    };

    // Unfiltered: the plain repository has no loadCandidateShapesNear, so
    // the service falls back to scoring every active shape.
    const plainRepo = new InMemoryStateEstimationRepository(shapes);
    const plainService = new StateEstimationService(plainRepo);
    await plainService.rehydrate();
    const unfiltered = await plainService.processPositionEvent(event);

    // Filtered: same shapes, reached through the grid.
    const cachedRepo = new CachedGeometryRepository(
      new InMemoryStateEstimationRepository(shapes),
      new NetworkGeometryCache(new InMemoryStateEstimationRepository(shapes), 60_000)
    );
    const cachedService = new StateEstimationService(cachedRepo);
    await cachedService.rehydrate();
    const filtered = await cachedService.processPositionEvent(event);

    expect(filtered.routeDirectionId).toBe("rd-near");
    expect(filtered).toEqual(unfiltered);
  });
});
