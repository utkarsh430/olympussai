import { describe, expect, it } from "vitest";
import { computeCorridorOrder, computeLeaderFollowerOrder } from "../src/state-estimation/ordering.js";
import type { CorridorVehicleInput, VehicleOrderingInput } from "../src/state-estimation/types.js";

function vehicle(overrides: Partial<VehicleOrderingInput>): VehicleOrderingInput {
  return {
    vehicleId: "v-1",
    routeDirectionId: "rd-1",
    distanceAlongRouteMeters: 0,
    isLowConfidence: false,
    ...overrides,
  };
}

describe("computeLeaderFollowerOrder (linear route)", () => {
  const linear = { isLoop: false, totalDistanceMeters: 1000 };

  it("orders vehicles furthest-along first and links leader/follower correctly", () => {
    const vehicles = [
      vehicle({ vehicleId: "back", distanceAlongRouteMeters: 100 }),
      vehicle({ vehicleId: "middle", distanceAlongRouteMeters: 500 }),
      vehicle({ vehicleId: "front", distanceAlongRouteMeters: 900 }),
    ];

    const ordered = computeLeaderFollowerOrder(vehicles, linear);
    const byId = Object.fromEntries(ordered.map((v) => [v.vehicleId, v]));

    expect(ordered.map((v) => v.vehicleId)).toEqual(["front", "middle", "back"]);
    expect(byId.front!.leaderVehicleId).toBeNull();
    expect(byId.front!.followerVehicleId).toBe("middle");
    expect(byId.middle!.leaderVehicleId).toBe("front");
    expect(byId.middle!.followerVehicleId).toBe("back");
    expect(byId.back!.leaderVehicleId).toBe("middle");
    expect(byId.back!.followerVehicleId).toBeNull();
  });

  it("excludes low-confidence vehicles from the chain instead of silently trusting their position", () => {
    const vehicles = [
      vehicle({ vehicleId: "trusted-front", distanceAlongRouteMeters: 900 }),
      vehicle({ vehicleId: "flagged", distanceAlongRouteMeters: 700, isLowConfidence: true }),
      vehicle({ vehicleId: "trusted-back", distanceAlongRouteMeters: 100 }),
    ];

    const ordered = computeLeaderFollowerOrder(vehicles, linear);
    const flagged = ordered.find((v) => v.vehicleId === "flagged")!;
    const front = ordered.find((v) => v.vehicleId === "trusted-front")!;
    const back = ordered.find((v) => v.vehicleId === "trusted-back")!;

    expect(flagged.rank).toBe(-1);
    expect(flagged.leaderVehicleId).toBeNull();
    expect(flagged.followerVehicleId).toBeNull();
    // The flagged vehicle never becomes trusted-back's leader.
    expect(front.followerVehicleId).toBe("trusted-back");
    expect(back.leaderVehicleId).toBe("trusted-front");
  });
});

describe("computeLeaderFollowerOrder (loop route)", () => {
  const loop = { isLoop: true, totalDistanceMeters: 1000 };

  it("wraps the leader-most vehicle's leader to the back-most vehicle, and vice versa", () => {
    const vehicles = [
      vehicle({ vehicleId: "near-start", distanceAlongRouteMeters: 20 }),
      vehicle({ vehicleId: "middle", distanceAlongRouteMeters: 500 }),
      vehicle({ vehicleId: "near-end", distanceAlongRouteMeters: 980 }),
    ];

    const ordered = computeLeaderFollowerOrder(vehicles, loop);

    // Without the loop wrap-around fix-up, the leader-most and back-most
    // vehicles would have null leader/follower links (a linear route's
    // ends); on a loop, computeLeaderFollowerOrder links them together
    // instead.
    expect(ordered[0]!.vehicleId).toBe("near-end");
    expect(ordered[0]!.leaderVehicleId).toBe("near-start");
    expect(ordered[ordered.length - 1]!.vehicleId).toBe("near-start");
    expect(ordered[ordered.length - 1]!.followerVehicleId).toBe("near-end");
  });

  it("does not attempt to wrap with a single vehicle", () => {
    const vehicles = [vehicle({ vehicleId: "solo", distanceAlongRouteMeters: 500 })];
    const ordered = computeLeaderFollowerOrder(vehicles, loop);
    expect(ordered[0]!.leaderVehicleId).toBeNull();
    expect(ordered[0]!.followerVehicleId).toBeNull();
  });
});

describe("computeCorridorOrder", () => {
  function corridorVehicle(overrides: Partial<CorridorVehicleInput>): CorridorVehicleInput {
    return {
      vehicleId: "v-1",
      routeDirectionId: "rd-1",
      distanceAlongRouteMeters: 0,
      isLowConfidence: false,
      corridorOffsetMeters: 0,
      corridorDirectionSign: 1,
      ...overrides,
    };
  }

  it("orders vehicles from two different routes sharing a trunk segment by corridor-relative distance", () => {
    // Route A enters the corridor at its own s=0 (offset 0, sign +1).
    // Route B enters the corridor 200m into its own shape, travelling the
    // corridor in the opposite physical sense (sign -1), so a vehicle at
    // route-B s=250 is 50m further into the corridor than route B's entry.
    const vehicles = [
      corridorVehicle({ vehicleId: "a-near", routeDirectionId: "rd-a", distanceAlongRouteMeters: 50, corridorOffsetMeters: 0, corridorDirectionSign: 1 }),
      corridorVehicle({ vehicleId: "b-far", routeDirectionId: "rd-b", distanceAlongRouteMeters: 250, corridorOffsetMeters: 200, corridorDirectionSign: -1 }),
    ];

    const ordered = computeCorridorOrder(vehicles);
    // a-near: corridorDistance = 0 + 1*50 = 50
    // b-far:  corridorDistance = 200 + (-1)*250 = -50
    expect(ordered[0]!.vehicleId).toBe("a-near");
    expect(ordered[0]!.corridorDistanceMeters).toBeCloseTo(50, 5);
    expect(ordered[1]!.vehicleId).toBe("b-far");
    expect(ordered[1]!.corridorDistanceMeters).toBeCloseTo(-50, 5);
    expect(ordered[0]!.leaderVehicleId).toBe(null);
    expect(ordered[0]!.followerVehicleId).toBe("b-far");
  });

  it("excludes vehicles on a route-direction with no corridor offset configured", () => {
    const vehicles = [
      corridorVehicle({ vehicleId: "configured", corridorOffsetMeters: 0 }),
      corridorVehicle({ vehicleId: "unconfigured", corridorOffsetMeters: null }),
    ];

    const ordered = computeCorridorOrder(vehicles);
    const unconfigured = ordered.find((v) => v.vehicleId === "unconfigured")!;
    expect(unconfigured.rank).toBe(-1);
    expect(unconfigured.corridorDistanceMeters).toBeNull();
  });
});
