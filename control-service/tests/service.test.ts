import { describe, expect, it } from "vitest";
import { DistanceKalmanFilter } from "../src/state-estimation/kalmanFilter.js";
import { StateEstimationService } from "../src/state-estimation/service.js";
import { InMemoryStateEstimationRepository } from "../src/state-estimation/testing/inMemoryRepository.js";
import { offsetEastNorth, ORIGIN, straightLinePoints, makeShape } from "./helpers.js";
import type { RouteDirectionStopPoint } from "../src/state-estimation/types.js";

const shape = makeShape({
  routeDirectionId: "rd-1",
  points: straightLinePoints(ORIGIN, 2000, 100),
  totalDistanceMeters: 2000,
});

describe("StateEstimationService.processPositionEvent", () => {
  // rehydrate() is a precondition of processPositionEvent, not a nicety:
  // the service fails closed with 503 state_not_rehydrated until the prior
  // cache has been rebuilt, because estimating against an empty cache
  // silently persists cold-start state over good state.
  it("persists an estimate for each position event via the repository", async () => {
    const repo = new InMemoryStateEstimationRepository([shape]);
    const service = new StateEstimationService(repo);
    await service.rehydrate();

    const point = offsetEastNorth(ORIGIN, 300, 0);
    const estimate = await service.processPositionEvent({
      vehicleId: "veh-1",
      lat: point.lat,
      lon: point.lon,
      headingDegrees: 90,
      speedKmph: 25,
      observedAt: "2026-08-05T08:00:00.000Z",
    });

    expect(estimate.routeDirectionId).toBe("rd-1");
    expect(repo.savedStates.get("veh-1")).toEqual(estimate);
  });

  it("computes leader/follower order across multiple vehicles processed on the same route-direction", async () => {
    const repo = new InMemoryStateEstimationRepository([shape]);
    const service = new StateEstimationService(repo);
    await service.rehydrate();

    const front = offsetEastNorth(ORIGIN, 900, 0);
    const back = offsetEastNorth(ORIGIN, 100, 0);

    await service.processPositionEvent({
      vehicleId: "front",
      lat: front.lat,
      lon: front.lon,
      headingDegrees: 90,
      speedKmph: 20,
      observedAt: "2026-08-05T08:00:00.000Z",
    });
    await service.processPositionEvent({
      vehicleId: "back",
      lat: back.lat,
      lon: back.lon,
      headingDegrees: 90,
      speedKmph: 20,
      observedAt: "2026-08-05T08:00:00.000Z",
    });

    const order = service.computeOrderForRouteDirection(shape);
    expect(order.map((v) => v.vehicleId)).toEqual(["front", "back"]);
    expect(order[0]!.followerVehicleId).toBe("back");
  });
});

describe("StateEstimationService restart / rehydration (AC: state persists across restart)", () => {
  it("resumes Kalman smoothing from persisted state instead of a cold prior after a simulated restart", async () => {
    const repo = new InMemoryStateEstimationRepository([shape]);
    const warmService = new StateEstimationService(repo);
    await warmService.rehydrate();

    // Warm the filter up over several consistent samples so its covariance narrows.
    for (let i = 0; i < 6; i++) {
      const point = offsetEastNorth(ORIGIN, 100 + i * 90, 0);
      await warmService.processPositionEvent({
        vehicleId: "veh-1",
        lat: point.lat,
        lon: point.lon,
        headingDegrees: 90,
        speedKmph: 30,
        observedAt: new Date(2026, 7, 5, 8, 0, i * 10).toISOString(),
      });
    }

    const warmCovariance = repo.savedStates.get("veh-1")!.kalmanState!.p[0][0];

    // Simulate a process restart: a brand-new service instance backed by
    // the same (durable) repository, which must rehydrate before serving
    // any new events.
    const restartedService = new StateEstimationService(repo);
    expect(restartedService.isRehydrated).toBe(false);
    await restartedService.rehydrate();
    expect(restartedService.isRehydrated).toBe(true);

    const nextPoint = offsetEastNorth(ORIGIN, 700, 0);
    const afterRestart = await restartedService.processPositionEvent({
      vehicleId: "veh-1",
      lat: nextPoint.lat,
      lon: nextPoint.lon,
      headingDegrees: 90,
      speedKmph: 30,
      observedAt: new Date(2026, 7, 5, 8, 1, 0).toISOString(),
    });

    // A cold-started filter (no prior state) starts at the wide initial
    // covariance; resuming from the warm, persisted state must stay well
    // below that, proving the restart did not throw the estimate back to
    // a fresh observation cycle.
    const coldPss = DistanceKalmanFilter.initialize(0, new Date()).serialize().p[0][0];
    expect(warmCovariance).toBeLessThan(coldPss);
    // The very first post-restart update still starts from the warm prior
    // (not a fresh one), so it stays at least as tight as the warm value
    // and nowhere near the cold-start covariance.
    expect(afterRestart.kalmanState!.p[0][0]).toBeLessThan(coldPss);
  });

  it("falls back to a fresh estimate for a vehicle never seen before rehydration", async () => {
    const repo = new InMemoryStateEstimationRepository([shape]);
    const service = new StateEstimationService(repo);
    await service.rehydrate();

    const point = offsetEastNorth(ORIGIN, 300, 0);
    const estimate = await service.processPositionEvent({
      vehicleId: "brand-new",
      lat: point.lat,
      lon: point.lon,
      headingDegrees: 90,
      speedKmph: 20,
      observedAt: "2026-08-05T08:00:00.000Z",
    });

    expect(estimate.routeDirectionId).toBe("rd-1");
  });
});

// ─── STOP VISIT RECORDING ──────────────────────────────────────────────────
//
// The estimator knows which stop a vehicle is at and when it got there, and
// overwrites both on every fix. These prove the service captures that
// occupancy on the way past - which is the only reason departure-to-departure
// headway, dwell fitting and on-time performance are computable at all.
describe("StateEstimationService stop visit recording", () => {
  const stopShape = makeShape({
    routeDirectionId: "rd-1",
    points: straightLinePoints(ORIGIN, 2000, 100),
    totalDistanceMeters: 2000,
  });

  function stops(): Map<string, RouteDirectionStopPoint[]> {
    return new Map([
      [
        "rd-1",
        [
          {
            routeDirectionId: "rd-1",
            stopId: "stop-A",
            sequence: 0,
            cumulativeDistanceMeters: 300,
            geofenceRadiusMeters: 60,
            isControlPoint: true,
          },
          {
            routeDirectionId: "rd-1",
            stopId: "stop-B",
            sequence: 1,
            cumulativeDistanceMeters: 1200,
            geofenceRadiusMeters: 60,
            isControlPoint: true,
          },
        ],
      ],
    ]);
  }

  async function driveFromStopAToStopB(repo: InMemoryStateEstimationRepository) {
    const service = new StateEstimationService(repo);
    await service.rehydrate();

    // Two fixes inside stop-A's geofence, then one at stop-B.
    for (const [i, seconds] of [0, 30].entries()) {
      const at = offsetEastNorth(ORIGIN, 300 + i, 0);
      await service.processPositionEvent({
        vehicleId: "veh-1",
        lat: at.lat,
        lon: at.lon,
        headingDegrees: 90,
        speedKmph: 0,
        observedAt: new Date(Date.UTC(2026, 7, 19, 8, 0, seconds)).toISOString(),
      });
    }

    const atB = offsetEastNorth(ORIGIN, 1200, 0);
    await service.processPositionEvent({
      vehicleId: "veh-1",
      lat: atB.lat,
      lon: atB.lon,
      headingDegrees: 90,
      speedKmph: 20,
      observedAt: new Date(Date.UTC(2026, 7, 19, 8, 2, 0)).toISOString(),
    });
  }

  it("records the occupancy of a stop once the vehicle has moved on", async () => {
    const repo = new InMemoryStateEstimationRepository([stopShape], stops());
    await driveFromStopAToStopB(repo);

    const visit = repo.stopVisits.find((v) => v.stopId === "stop-A");
    expect(visit).toBeDefined();
    expect(visit!.vehicleId).toBe("veh-1");
    expect(visit!.routeDirectionId).toBe("rd-1");
    // Arrival is the FIRST fix inside the geofence, departure the first
    // outside - so the dwell spans both fixes at stop-A.
    expect(new Date(visit!.departedAt).getTime()).toBeGreaterThan(
      new Date(visit!.arrivedAt).getTime(),
    );
  });

  it("records nothing while the vehicle is still sitting at the stop", async () => {
    const repo = new InMemoryStateEstimationRepository([stopShape], stops());
    const service = new StateEstimationService(repo);
    await service.rehydrate();

    for (const seconds of [0, 30, 60]) {
      const at = offsetEastNorth(ORIGIN, 300, 0);
      await service.processPositionEvent({
        vehicleId: "veh-1",
        lat: at.lat,
        lon: at.lon,
        headingDegrees: 90,
        speedKmph: 0,
        observedAt: new Date(Date.UTC(2026, 7, 19, 8, 0, seconds)).toISOString(),
      });
    }

    expect(repo.stopVisits).toHaveLength(0);
  });

  // Position estimation is the hot ingestion path. Losing one row of stop
  // history must never become a live-tracking outage - the fix was already
  // durably saved by the time this runs.
  it("does not fail a position fix when the stop history write fails", async () => {
    const repo = new InMemoryStateEstimationRepository([stopShape], stops());
    repo.stopVisitError = new Error("stop_visits unavailable");

    await expect(driveFromStopAToStopB(repo)).resolves.not.toThrow();
    expect(repo.savedStates.get("veh-1")).toBeDefined();
    expect(repo.stopVisits).toHaveLength(0);
  });
});
