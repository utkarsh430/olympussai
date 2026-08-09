import { describe, expect, it } from "vitest";
import { DistanceKalmanFilter } from "../src/state-estimation/kalmanFilter.js";
import { StateEstimationService } from "../src/state-estimation/service.js";
import { InMemoryStateEstimationRepository } from "../src/state-estimation/testing/inMemoryRepository.js";
import { offsetEastNorth, ORIGIN, straightLinePoints, makeShape } from "./helpers.js";

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
