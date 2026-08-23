import { describe, expect, it } from "vitest";
import {
  computeAggregate,
  computeGapMeters,
  computePairHeadways,
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
  // h_fwd and h_bwd are BOTH about the follower - the vehicle a hold would
  // be issued to (mpc/twoWayHold.ts uses `followerVehicleId`). h_fwd is its
  // gap to the bus ahead; h_bwd is the gap from the bus BEHIND it, closed at
  // that bus's own pace. Three vehicles are needed to have both, which is
  // the whole point: a two-way-looking law cannot be fed by a pair.
  it("measures h_fwd to the bus ahead and h_bwd from the bus behind, each at that bus's own speed", () => {
    const ordered: OrderedVehicle[] = [
      vehicle({ vehicleId: "leader", distanceAlongRouteMeters: 1000, rank: 0, followerVehicleId: "follower" }),
      vehicle({
        vehicleId: "follower",
        distanceAlongRouteMeters: 500,
        rank: 1,
        leaderVehicleId: "leader",
        followerVehicleId: "trailer",
      }),
      vehicle({ vehicleId: "trailer", distanceAlongRouteMeters: 200, rank: 2, leaderVehicleId: "follower" }),
    ];
    const speeds = new Map([
      ["leader", 36], // 10 m/s
      ["follower", 18], // 5 m/s
      ["trailer", 54], // 15 m/s
    ]);
    const confidences = new Map([
      ["leader", 0.9],
      ["follower", 0.8],
      ["trailer", 0.7],
    ]);

    const pairs = computePairHeadways(ordered, speeds, confidences, { totalDistanceMeters: 2000 }, "rd-1", 300);

    // One row per leader/follower link: (leader, follower) and (follower, trailer).
    expect(pairs).toHaveLength(2);
    const pair = pairs[0]!;
    expect(pair.followerVehicleId).toBe("follower");
    expect(pair.gapMeters).toBe(500);
    expect(pair.hFwdSeconds).toBe(100); // 500m ahead / 5 m/s (follower's own speed)
    expect(pair.hBwdSeconds).toBe(20); // 300m behind / 15 m/s (trailer's speed)
    expect(pair.deviationSeconds).toBe(100 - 300);
    expect(pair.confidence).toBe(0.8);
  });

  // The regression this definition exists for. Two buses travelling at the
  // same speed used to report h_fwd == h_bwd, which collapses the two-way
  // law Kf(H*-h_fwd) - Kb(H*-h_bwd) to a forward-only (Kf-Kb)(H*-h_fwd).
  // The backward headway must depend on the bus BEHIND and on nothing else.
  it("does not derive h_bwd from the leader's pace: equal speeds must not make h_bwd mirror h_fwd", () => {
    const ordered: OrderedVehicle[] = [
      vehicle({ vehicleId: "leader", distanceAlongRouteMeters: 1000, rank: 0, followerVehicleId: "follower" }),
      vehicle({
        vehicleId: "follower",
        distanceAlongRouteMeters: 500,
        rank: 1,
        leaderVehicleId: "leader",
        followerVehicleId: "trailer",
      }),
      vehicle({ vehicleId: "trailer", distanceAlongRouteMeters: 100, rank: 2, leaderVehicleId: "follower" }),
    ];
    // Leader and follower keep identical pace; only the trailer differs.
    const speeds = new Map([
      ["leader", 36],
      ["follower", 36], // 10 m/s
      ["trailer", 72], // 20 m/s - closing fast from behind
    ]);

    const pairs = computePairHeadways(ordered, speeds, new Map(), { totalDistanceMeters: 2000 }, "rd-1", 300);

    const pair = pairs[0]!;
    expect(pair.hFwdSeconds).toBe(50); // 500m / 10 m/s
    expect(pair.hBwdSeconds).toBe(20); // 400m / 20 m/s - a different number entirely
    expect(pair.hBwdSeconds).not.toBe(pair.hFwdSeconds);
  });

  // The back-most bus on a linear route has nothing behind it. That is a
  // real absence, and mpc/twoWayHold.ts's documented response to it is to
  // decline the pair so mpc/selfEqualizing.ts takes it.
  it("reports a null h_bwd for the back-most vehicle rather than inventing a neighbour", () => {
    const ordered: OrderedVehicle[] = [
      vehicle({ vehicleId: "leader", distanceAlongRouteMeters: 1000, rank: 0, followerVehicleId: "follower" }),
      vehicle({ vehicleId: "follower", distanceAlongRouteMeters: 500, rank: 1, leaderVehicleId: "leader" }),
    ];
    const speeds = new Map([
      ["leader", 36],
      ["follower", 18],
    ]);

    const pairs = computePairHeadways(ordered, speeds, new Map(), { totalDistanceMeters: 2000 }, "rd-1", 300);

    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.hFwdSeconds).toBe(100);
    expect(pairs[0]!.hBwdSeconds).toBeNull();
  });

  // On a loop every vehicle has a follower via the wrap link, so h_bwd is
  // always available - including for the vehicle furthest along, whose
  // trailer is measured across the wrap.
  it("measures h_bwd across the loop wrap for the leader-most vehicle", () => {
    const ordered: OrderedVehicle[] = [
      vehicle({
        vehicleId: "front",
        distanceAlongRouteMeters: 1800,
        rank: 0,
        leaderVehicleId: "back",
        followerVehicleId: "back",
      }),
      vehicle({
        vehicleId: "back",
        distanceAlongRouteMeters: 200,
        rank: 1,
        leaderVehicleId: "front",
        followerVehicleId: "front",
      }),
    ];
    const speeds = new Map([
      ["front", 36], // 10 m/s
      ["back", 36],
    ]);

    const pairs = computePairHeadways(ordered, speeds, new Map(), { totalDistanceMeters: 2000 }, "rd-1", 300);

    const backPair = pairs.find((p) => p.followerVehicleId === "back")!;
    expect(backPair.hFwdSeconds).toBe(160); // 1600m ahead / 10 m/s
    // "back"'s own follower is "front" via the wrap: 2000 - (1800 - 200) = 400m.
    expect(backPair.hBwdSeconds).toBe(40);
  });

  it("excludes low-confidence (rank -1) vehicles and skips a leader with no follower link", () => {
    const ordered: OrderedVehicle[] = [
      vehicle({ vehicleId: "solo", distanceAlongRouteMeters: 1000, rank: 0, followerVehicleId: null }),
      vehicle({ vehicleId: "flagged", distanceAlongRouteMeters: 500, rank: -1 }),
    ];
    const pairs = computePairHeadways(ordered, new Map(), new Map(), { totalDistanceMeters: 2000 }, "rd-1", 300);
    expect(pairs).toHaveLength(0);
  });

  // ─── The stationary-vehicle contract ───────────────────────────────────
  //
  // A bus standing at a stop used to be measured at MIN_SPEED_KMPH, which
  // turned any real gap into hours and reported a bunched pair as "fine". That
  // mattered far more than it looks: `mpc/eligibility.ts` only permits a hold
  // when the bus is AT or APPROACHING a stop, so the deployed system asked
  // "how bunched is this?" at exactly the moment its own estimator could not
  // answer. See the header of src/headway/metrics.ts.

  it("measures a bus standing at a stop against the pace the corridor is running at", () => {
    const ordered: OrderedVehicle[] = [
      vehicle({ vehicleId: "leader", distanceAlongRouteMeters: 4000, rank: 0, followerVehicleId: "follower" }),
      vehicle({ vehicleId: "follower", distanceAlongRouteMeters: 0, rank: 1, leaderVehicleId: "leader", followerVehicleId: "trailer" }),
      vehicle({ vehicleId: "trailer", distanceAlongRouteMeters: -4000, rank: 2, leaderVehicleId: "follower" }),
    ];
    // The follower is dwelling. The rest of the corridor is doing 36 km/h.
    const speeds = new Map([
      ["leader", 36],
      ["follower", 0],
      ["trailer", 36],
    ]);
    const pairs = computePairHeadways(ordered, speeds, new Map(), { totalDistanceMeters: 200000 }, "rd-1", 300);
    // 4,000 m at the corridor's 36 km/h (10 m/s) is 400 s - a real, actionable
    // headway. Measured at the follower's own 0 km/h it would have been
    // 4,000 / (1 / 3.6) = 14,400 s, thirty-six times the target headway, and
    // every law and both detection tiers would have called the pair healthy.
    expect(pairs[0]!.hFwdSeconds).toBe(400);
  });

  it("keeps its own speed for a vehicle that is genuinely under way", () => {
    const ordered: OrderedVehicle[] = [
      vehicle({ vehicleId: "leader", distanceAlongRouteMeters: 4000, rank: 0, followerVehicleId: "follower" }),
      vehicle({ vehicleId: "follower", distanceAlongRouteMeters: 0, rank: 1, leaderVehicleId: "leader" }),
    ];
    // The follower is crawling at 18 km/h while the corridor does 36. It is
    // moving, so it is measured at its own pace and NOT flattered by the
    // corridor's - the borrow is for stationary vehicles only.
    const speeds = new Map([
      ["leader", 36],
      ["follower", 18],
    ]);
    const pairs = computePairHeadways(ordered, speeds, new Map(), { totalDistanceMeters: 200000 }, "rd-1", 300);
    expect(pairs[0]!.hFwdSeconds).toBe(800);
  });

  it("says nothing at all when the whole corridor is stationary", () => {
    const ordered: OrderedVehicle[] = [
      vehicle({ vehicleId: "leader", distanceAlongRouteMeters: 100000, rank: 0, followerVehicleId: "follower" }),
      vehicle({ vehicleId: "follower", distanceAlongRouteMeters: 0, rank: 1, leaderVehicleId: "leader" }),
    ];
    const speeds = new Map([
      ["leader", 0],
      ["follower", 0],
    ]);
    const pairs = computePairHeadways(ordered, speeds, new Map(), { totalDistanceMeters: 200000 }, "rd-1", 300);
    // No vehicle is moving, so there is no pace to borrow and no honest way to
    // convert a gap in metres into a gap in seconds. Null is "no opinion", and
    // every consumer already treats it as "no headway state for this pair".
    // The old MAX_HEADWAY_SECONDS answer was a number that looked like a
    // measurement and was not one.
    expect(pairs[0]!.hFwdSeconds).toBeNull();
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
    expect(pairs[0]!.confidence).toBeNull();
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
