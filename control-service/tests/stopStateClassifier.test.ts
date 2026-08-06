import { describe, expect, it } from "vitest";
import { classifyStopState } from "../src/state-estimation/stopStateClassifier.js";

const stop = { stopId: "stop-1", cumulativeDistanceMeters: 500, geofenceRadiusMeters: 30 };

describe("classifyStopState", () => {
  it("classifies off-route regardless of anything else", () => {
    const result = classifyStopState({
      speedKmph: 0,
      distanceAlongRouteMeters: 500,
      nearestStop: stop,
      isHeldByController: true,
      isOffRoute: true,
    });
    expect(result).toEqual({ stopState: "off_route", currentStopId: null });
  });

  it("classifies held_by_controller when a hold is active, even within a stop geofence", () => {
    const result = classifyStopState({
      speedKmph: 0,
      distanceAlongRouteMeters: 500,
      nearestStop: stop,
      isHeldByController: true,
      isOffRoute: false,
    });
    expect(result).toEqual({ stopState: "held_by_controller", currentStopId: "stop-1" });
  });

  it("classifies dwelling_at_stop when slow and inside the geofence", () => {
    const result = classifyStopState({
      speedKmph: 1,
      distanceAlongRouteMeters: 505,
      nearestStop: stop,
      isHeldByController: false,
      isOffRoute: false,
    });
    expect(result).toEqual({ stopState: "dwelling_at_stop", currentStopId: "stop-1" });
  });

  it("classifies approaching_stop when nearing the geofence from before it", () => {
    const result = classifyStopState({
      speedKmph: 20,
      distanceAlongRouteMeters: 420,
      nearestStop: stop,
      isHeldByController: false,
      isOffRoute: false,
    });
    expect(result).toEqual({ stopState: "approaching_stop", currentStopId: "stop-1" });
  });

  it("classifies departed_stop when moving forward and just past the geofence boundary", () => {
    const result = classifyStopState({
      speedKmph: 15,
      distanceAlongRouteMeters: 505,
      nearestStop: stop,
      isHeldByController: false,
      isOffRoute: false,
    });
    expect(result).toEqual({ stopState: "departed_stop", currentStopId: "stop-1" });
  });

  it("classifies stopped_in_traffic when slow but far from any stop", () => {
    const result = classifyStopState({
      speedKmph: 0,
      distanceAlongRouteMeters: 100,
      nearestStop: stop,
      isHeldByController: false,
      isOffRoute: false,
    });
    expect(result).toEqual({ stopState: "stopped_in_traffic", currentStopId: null });
  });

  it("classifies departed_stop when moving normally, far from any stop", () => {
    const result = classifyStopState({
      speedKmph: 30,
      distanceAlongRouteMeters: 100,
      nearestStop: stop,
      isHeldByController: false,
      isOffRoute: false,
    });
    expect(result).toEqual({ stopState: "departed_stop", currentStopId: null });
  });

  it("handles a route-direction with no configured stops", () => {
    const result = classifyStopState({
      speedKmph: 30,
      distanceAlongRouteMeters: 100,
      nearestStop: null,
      isHeldByController: false,
      isOffRoute: false,
    });
    expect(result).toEqual({ stopState: "departed_stop", currentStopId: null });
  });
});
