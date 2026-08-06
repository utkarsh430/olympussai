import { describe, expect, it } from "vitest";
import {
  computeAggregate,
  computeGapMeters,
  computePairHeadways,
  MAX_HEADWAY_SECONDS,
} from "../../src/headway/metrics.js";
import type { OrderedVehicle } from "../../src/state-estimation/types.js";

function vehicle(overrides: Partial<OrderedVehicle> & { vehicleId: string }): OrderedVehicle {
  return {
    routeDirectionId: "rd-1",
    distanceAlongRouteMeters: 0,
    isLowConfidence: false,
    rank: 0,
    leaderVehicleId: null,
    followerVehicleId: null,
    ...overrides,
  };
}

describe("computeGapMeters", () => {
  it("returns the plain distance difference for a non-wrapped pair", () => {
    expect(computeGapMeters(900, 100, 2000)).toBe(800);
  });

  it("wraps forward around a loop when the follower's raw distance exceeds the leader's", () => {
    // leader at 50 (near the start after wrapping), follower at 950 (near
    // the end of the lap) - the physical forward gap wraps through the
    // loop point.
    expect(computeGapMeters(50, 950, 1000)).toBe(100);
  });

  it("never returns a negative gap", () => {
    expect(computeGapMeters(0, 0, 1000)).toBe(0);
  });
});

describe("computePairHeadways", () => {
  it("computes forward/backward headway from gap and each vehicle's own speed", () => {
    const ordered: OrderedVehicle[] = [
      vehicle({ vehicleId: "leader", distanceAlongRouteMeters: 1000, rank: 0, followerVehicleId: "follower" }),
      vehicle({ vehicleId: "follower", distanceAlongRouteMeters: 500, rank: 1, leaderVehicleId: "leader" }),
    ];
    const speeds = new Map([
      ["leader", 36], // 10 m/s
      ["follower", 18], // 5 m/s
    ]);
    const confidences = new Map([
      ["leader", 0.9],
      ["follower", 0.8],
    ]);

    const pairs = computePairHeadways(ordered, speeds, confidences, { totalDistanceMeters: 2000 }, "rd-1", 300);

    expect(pairs).toHaveLength(1);
    const pair = pairs[0]!;
    expect(pair.gapMeters).toBe(500);
    expect(pair.hFwdSeconds).toBe(100); // 500m / 5 m/s (follower's speed)
    expect(pair.hBwdSeconds).toBe(50); // 500m / 10 m/s (leader's speed)
    expect(pair.deviationSeconds).toBe(100 - 300);
    expect(pair.confidence).toBe(0.8);
  });

  it("excludes low-confidence (rank -1) vehicles and skips a leader with no follower link", () => {
    const ordered: OrderedVehicle[] = [
      vehicle({ vehicleId: "solo", distanceAlongRouteMeters: 1000, rank: 0, followerVehicleId: null }),
      vehicle({ vehicleId: "flagged", distanceAlongRouteMeters: 500, rank: -1 }),
    ];
    const pairs = computePairHeadways(ordered, new Map(), new Map(), { totalDistanceMeters: 2000 }, "rd-1", 300);
    expect(pairs).toHaveLength(0);
  });

  it("floors a near-zero speed instead of dividing by zero, and caps at MAX_HEADWAY_SECONDS", () => {
    const ordered: OrderedVehicle[] = [
      vehicle({ vehicleId: "leader", distanceAlongRouteMeters: 100000, rank: 0, followerVehicleId: "follower" }),
      vehicle({ vehicleId: "follower", distanceAlongRouteMeters: 0, rank: 1, leaderVehicleId: "leader" }),
    ];
    const speeds = new Map([
      ["leader", 0],
      ["follower", 0],
    ]);
    const pairs = computePairHeadways(ordered, speeds, new Map(), { totalDistanceMeters: 200000 }, "rd-1", 300);
    expect(pairs[0]!.hFwdSeconds).toBe(MAX_HEADWAY_SECONDS);
    expect(pairs[0]!.hBwdSeconds).toBe(MAX_HEADWAY_SECONDS);
  });

  it("returns null headways when speed telemetry is missing", () => {
    const ordered: OrderedVehicle[] = [
      vehicle({ vehicleId: "leader", distanceAlongRouteMeters: 1000, rank: 0, followerVehicleId: "follower" }),
      vehicle({ vehicleId: "follower", distanceAlongRouteMeters: 500, rank: 1, leaderVehicleId: "leader" }),
    ];
    const pairs = computePairHeadways(ordered, new Map(), new Map(), { totalDistanceMeters: 2000 }, "rd-1", 300);
    expect(pairs[0]!.hFwdSeconds).toBeNull();
    expect(pairs[0]!.hBwdSeconds).toBeNull();
    expect(pairs[0]!.deviationSeconds).toBeNull();
  });
});

describe("computeAggregate", () => {
  it("returns nulls for an empty sample set", () => {
    const aggregate = computeAggregate([], "rd-1", 300);
    expect(aggregate).toMatchObject({ sampleCount: 0, meanHeadwaySeconds: null, cv: null, ewtSeconds: null });
  });

  it("computes mean/stddev/CV and EWT from a set of forward headways", () => {
    // Perfectly even headways: no dispersion, CV = 0, EWT = 0.
    const evenPairs = [300, 300, 300].map((hFwdSeconds, i) => ({
      routeDirectionId: "rd-1",
      leaderVehicleId: `l${i}`,
      followerVehicleId: `f${i}`,
      gapMeters: 0,
      hFwdSeconds,
      hBwdSeconds: null,
      targetHeadwaySeconds: 300,
      deviationSeconds: 0,
      confidence: null,
    }));
    const even = computeAggregate(evenPairs, "rd-1", 300);
    expect(even.sampleCount).toBe(3);
    expect(even.meanHeadwaySeconds).toBe(300);
    expect(even.cv).toBe(0);
    expect(even.ewtSeconds).toBe(0);

    // Uneven headways (bunched then gapped): CV and EWT should both be positive.
    const unevenPairs = [60, 60, 540].map((hFwdSeconds, i) => ({
      routeDirectionId: "rd-1",
      leaderVehicleId: `l${i}`,
      followerVehicleId: `f${i}`,
      gapMeters: 0,
      hFwdSeconds,
      hBwdSeconds: null,
      targetHeadwaySeconds: 300,
      deviationSeconds: hFwdSeconds - 300,
      confidence: null,
    }));
    const uneven = computeAggregate(unevenPairs, "rd-1", 300);
    expect(uneven.sampleCount).toBe(3);
    expect(uneven.meanHeadwaySeconds).toBe(220);
    expect(uneven.cv).toBeGreaterThan(0);
    expect(uneven.ewtSeconds).toBeGreaterThan(0);
  });

  it("is zero (never negative) when actual headway matches target with no dispersion", () => {
    const pairs = [100, 100].map((hFwdSeconds, i) => ({
      routeDirectionId: "rd-1",
      leaderVehicleId: `l${i}`,
      followerVehicleId: `f${i}`,
      gapMeters: 0,
      hFwdSeconds,
      hBwdSeconds: null,
      targetHeadwaySeconds: 100,
      deviationSeconds: hFwdSeconds - 100,
      confidence: null,
    }));
    const aggregate = computeAggregate(pairs, "rd-1", 100);
    expect(aggregate.ewtSeconds).toBe(0);
  });

  it("rises when actual headway runs consistently longer than the scheduled target", () => {
    // Even (zero-variance) headways, but 3x the target: passengers wait
    // longer on average than the schedule promises, so EWT is positive
    // even though there's no bunching-style dispersion.
    const pairs = [300, 300].map((hFwdSeconds, i) => ({
      routeDirectionId: "rd-1",
      leaderVehicleId: `l${i}`,
      followerVehicleId: `f${i}`,
      gapMeters: 0,
      hFwdSeconds,
      hBwdSeconds: null,
      targetHeadwaySeconds: 100,
      deviationSeconds: hFwdSeconds - 100,
      confidence: null,
    }));
    const aggregate = computeAggregate(pairs, "rd-1", 100);
    expect(aggregate.cv).toBe(0);
    expect(aggregate.ewtSeconds).toBeGreaterThan(0);
  });
});
