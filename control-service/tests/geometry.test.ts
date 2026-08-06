import { describe, expect, it } from "vitest";
import {
  angularDifferenceDegrees,
  bearingDegrees,
  haversineDistanceMeters,
  lineStringLengthMeters,
  projectPointOntoLineString,
  unwrapLoopMeasurement,
  wrapDistance,
} from "../src/state-estimation/geometry.js";
import { offsetEastNorth, ORIGIN, straightLinePoints } from "./helpers.js";

describe("haversineDistanceMeters", () => {
  it("returns ~0 for identical points", () => {
    expect(haversineDistanceMeters(ORIGIN, ORIGIN)).toBeCloseTo(0, 3);
  });

  it("returns approximately the offset distance for a small eastward offset", () => {
    const target = offsetEastNorth(ORIGIN, 500, 0);
    expect(haversineDistanceMeters(ORIGIN, target)).toBeCloseTo(500, -1);
  });
});

describe("bearingDegrees / angularDifferenceDegrees", () => {
  it("reports ~90 degrees (east) for an eastward offset", () => {
    const target = offsetEastNorth(ORIGIN, 500, 0);
    expect(bearingDegrees(ORIGIN, target)).toBeCloseTo(90, 0);
  });

  it("computes the smallest angle between two bearings", () => {
    expect(angularDifferenceDegrees(10, 350)).toBeCloseTo(20, 0);
    expect(angularDifferenceDegrees(0, 180)).toBeCloseTo(180, 0);
  });
});

describe("lineStringLengthMeters", () => {
  it("sums segment lengths", () => {
    const points = straightLinePoints(ORIGIN, 1000, 100);
    expect(lineStringLengthMeters(points)).toBeCloseTo(1000, -1);
  });
});

describe("projectPointOntoLineString", () => {
  const points = straightLinePoints(ORIGIN, 1000, 100);

  it("projects a point exactly on the line to its distance-along-line with ~0 perpendicular offset", () => {
    const onLine = offsetEastNorth(ORIGIN, 300, 0);
    const result = projectPointOntoLineString(onLine, points);
    expect(result.distanceAlongLineMeters).toBeCloseTo(300, 0);
    expect(result.perpendicularDistanceMeters).toBeCloseTo(0, 0);
  });

  it("reports perpendicular offset for a point off the line", () => {
    const offLine = offsetEastNorth(ORIGIN, 300, 25);
    const result = projectPointOntoLineString(offLine, points);
    expect(result.distanceAlongLineMeters).toBeCloseTo(300, 0);
    expect(result.perpendicularDistanceMeters).toBeCloseTo(25, 0);
  });

  it("clamps to the start of the line for a point before it", () => {
    const before = offsetEastNorth(ORIGIN, -200, 0);
    const result = projectPointOntoLineString(before, points);
    expect(result.distanceAlongLineMeters).toBeCloseTo(0, 0);
  });

  it("clamps to the end of the line for a point past it", () => {
    const after = offsetEastNorth(ORIGIN, 1500, 0);
    const result = projectPointOntoLineString(after, points);
    expect(result.distanceAlongLineMeters).toBeCloseTo(1000, -1);
  });

  it("throws for a degenerate (single-point) line", () => {
    expect(() => projectPointOntoLineString(ORIGIN, [ORIGIN])).toThrow();
  });
});

describe("wrapDistance", () => {
  it("wraps a distance past the loop length back into [0, total)", () => {
    expect(wrapDistance(1050, 1000)).toBeCloseTo(50, 5);
  });

  it("wraps a negative distance into [0, total)", () => {
    expect(wrapDistance(-50, 1000)).toBeCloseTo(950, 5);
  });

  it("leaves an in-range distance unchanged", () => {
    expect(wrapDistance(400, 1000)).toBeCloseTo(400, 5);
  });
});

describe("unwrapLoopMeasurement", () => {
  it("expresses a measurement just after a wrap as a small forward step, not a huge jump", () => {
    // filter is at 9,980m of a 10,000m loop; the next raw measurement wraps to 30m.
    const unwrapped = unwrapLoopMeasurement(30, 9980, 10000);
    expect(unwrapped).toBeCloseTo(10030, 5);
  });

  it("is a no-op when there is no wrap involved", () => {
    expect(unwrapLoopMeasurement(500, 480, 10000)).toBeCloseTo(500, 5);
  });
});
