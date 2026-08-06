import { describe, expect, it } from "vitest";
import { estimateVehicleState } from "../src/state-estimation/estimator.js";
import { LOW_CONFIDENCE_THRESHOLD } from "../src/state-estimation/confidence.js";
import { offsetEastNorth, ORIGIN, straightLinePoints, makeShape } from "./helpers.js";
import type { PriorVehicleState, RouteDirectionStopPoint } from "../src/state-estimation/types.js";

const shape = makeShape({
  routeDirectionId: "rd-1",
  points: straightLinePoints(ORIGIN, 2000, 100),
  totalDistanceMeters: 2000,
});

const stop: RouteDirectionStopPoint = {
  routeDirectionId: "rd-1",
  stopId: "stop-500",
  sequence: 1,
  cumulativeDistanceMeters: 500,
  geofenceRadiusMeters: 30,
  isControlPoint: false,
};

const stopsByDirection = new Map([[shape.routeDirectionId, [stop]]]);

describe("estimateVehicleState", () => {
  it("returns off_route with no candidate shapes, flagged not silently trusted", () => {
    const result = estimateVehicleState({
      vehicleId: "v-1",
      event: { vehicleId: "v-1", lat: ORIGIN.lat, lon: ORIGIN.lon, observedAt: "2026-08-05T08:00:00.000Z" },
      candidateShapes: [],
      nearestStopsByRouteDirection: new Map(),
      priorState: null,
      isHeldByController: false,
      tripId: null,
    });

    expect(result.routeDirectionId).toBeNull();
    expect(result.stopState).toBe("off_route");
    expect(result.isLowConfidence).toBe(true);
  });

  it("assigns distance-along-route, direction, and stop-state on the first fix", () => {
    const point = offsetEastNorth(ORIGIN, 300, 0);
    const result = estimateVehicleState({
      vehicleId: "v-1",
      event: {
        vehicleId: "v-1",
        lat: point.lat,
        lon: point.lon,
        headingDegrees: 90,
        speedKmph: 25,
        observedAt: "2026-08-05T08:00:00.000Z",
      },
      candidateShapes: [shape],
      nearestStopsByRouteDirection: stopsByDirection,
      priorState: null,
      isHeldByController: false,
      tripId: null,
    });

    expect(result.routeDirectionId).toBe("rd-1");
    expect(result.distanceAlongRouteMeters).toBeCloseTo(300, -1);
    expect(result.stopState).not.toBe("off_route");
    expect(result.kalmanState).not.toBeNull();
    expect(result.isLowConfidence).toBe(false);
  });

  it("updates distance-along-route and smooths across consecutive events using prior state", () => {
    const firstPoint = offsetEastNorth(ORIGIN, 300, 0);
    const first = estimateVehicleState({
      vehicleId: "v-1",
      event: {
        vehicleId: "v-1",
        lat: firstPoint.lat,
        lon: firstPoint.lon,
        headingDegrees: 90,
        speedKmph: 25,
        observedAt: "2026-08-05T08:00:00.000Z",
      },
      candidateShapes: [shape],
      nearestStopsByRouteDirection: stopsByDirection,
      priorState: null,
      isHeldByController: false,
      tripId: null,
    });

    const priorState: PriorVehicleState = {
      routeDirectionId: first.routeDirectionId,
      kalmanState: first.kalmanState,
      confidence: first.confidence,
      currentStopId: first.currentStopId,
      stopEnteredAt: first.stopEnteredAt,
    };

    const secondPoint = offsetEastNorth(ORIGIN, 480, 0);
    const second = estimateVehicleState({
      vehicleId: "v-1",
      event: {
        vehicleId: "v-1",
        lat: secondPoint.lat,
        lon: secondPoint.lon,
        headingDegrees: 90,
        speedKmph: 25,
        observedAt: "2026-08-05T08:00:10.000Z",
      },
      candidateShapes: [shape],
      nearestStopsByRouteDirection: stopsByDirection,
      priorState,
      isHeldByController: false,
      tripId: null,
    });

    expect(second.distanceAlongRouteMeters!).toBeGreaterThan(first.distanceAlongRouteMeters!);
    // Approaching the stop at 500m from 480m at low reported speed nearby should not be off-route.
    expect(second.stopState).not.toBe("off_route");
  });

  it("classifies dwelling_at_stop and stamps stopEnteredAt when stationary in a stop geofence", () => {
    const point = offsetEastNorth(ORIGIN, 505, 0);
    const result = estimateVehicleState({
      vehicleId: "v-1",
      event: {
        vehicleId: "v-1",
        lat: point.lat,
        lon: point.lon,
        headingDegrees: 90,
        speedKmph: 0,
        observedAt: "2026-08-05T08:01:00.000Z",
      },
      candidateShapes: [shape],
      nearestStopsByRouteDirection: stopsByDirection,
      priorState: null,
      isHeldByController: false,
      tripId: null,
    });

    expect(result.stopState).toBe("dwelling_at_stop");
    expect(result.currentStopId).toBe("stop-500");
    expect(result.stopEnteredAt).toBe("2026-08-05T08:01:00.000Z");
  });

  it("preserves stopEnteredAt across updates while still dwelling at the same stop", () => {
    const point = offsetEastNorth(ORIGIN, 505, 0);
    const priorState: PriorVehicleState = {
      routeDirectionId: "rd-1",
      kalmanState: { s: 505, v: 0, p: [[10, 0], [0, 5]], updatedAt: "2026-08-05T08:01:00.000Z" },
      confidence: 0.9,
      currentStopId: "stop-500",
      stopEnteredAt: "2026-08-05T08:01:00.000Z",
    };

    const result = estimateVehicleState({
      vehicleId: "v-1",
      event: {
        vehicleId: "v-1",
        lat: point.lat,
        lon: point.lon,
        headingDegrees: 90,
        speedKmph: 0,
        observedAt: "2026-08-05T08:01:20.000Z",
      },
      candidateShapes: [shape],
      nearestStopsByRouteDirection: stopsByDirection,
      priorState,
      isHeldByController: false,
      tripId: null,
    });

    expect(result.stopState).toBe("dwelling_at_stop");
    expect(result.stopEnteredAt).toBe("2026-08-05T08:01:00.000Z");
  });

  it("flags a marginal off-line fix as low confidence but still returns an estimate", () => {
    const point = offsetEastNorth(ORIGIN, 300, 55); // well off the line, but within off-route cutoff
    const result = estimateVehicleState({
      vehicleId: "v-1",
      event: {
        vehicleId: "v-1",
        lat: point.lat,
        lon: point.lon,
        speedKmph: 20,
        observedAt: "2026-08-05T08:00:00.000Z",
      },
      candidateShapes: [shape],
      nearestStopsByRouteDirection: stopsByDirection,
      priorState: null,
      isHeldByController: false,
      tripId: null,
    });

    expect(result.confidence).toBeLessThan(LOW_CONFIDENCE_THRESHOLD);
    expect(result.isLowConfidence).toBe(true);
    // Not silently trusted, but also not dropped: still carries a route/distance so callers can persist and flag it.
    expect(result.routeDirectionId).toBe("rd-1");
  });

  it("marks held_by_controller and keeps the vehicle's nearest stop, overriding speed-based classification", () => {
    const point = offsetEastNorth(ORIGIN, 200, 0);
    const result = estimateVehicleState({
      vehicleId: "v-1",
      event: {
        vehicleId: "v-1",
        lat: point.lat,
        lon: point.lon,
        speedKmph: 0,
        observedAt: "2026-08-05T08:00:00.000Z",
      },
      candidateShapes: [shape],
      nearestStopsByRouteDirection: stopsByDirection,
      priorState: null,
      isHeldByController: true,
      tripId: null,
    });

    expect(result.stopState).toBe("held_by_controller");
  });
});
