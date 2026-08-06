import { describe, expect, it } from "vitest";
import {
  LOW_CONFIDENCE_THRESHOLD,
  scoreDirectionConfidence,
  selectChosenCandidate,
} from "../src/state-estimation/confidence.js";
import type { MapMatchCandidate } from "../src/state-estimation/types.js";

function candidate(overrides: Partial<MapMatchCandidate>): MapMatchCandidate {
  return {
    routeDirectionId: "rd-1",
    projectedDistanceMeters: 100,
    perpendicularDistanceMeters: 5,
    headingDeltaDegrees: 5,
    segmentHeadingDegrees: 90,
    ...overrides,
  };
}

describe("scoreDirectionConfidence", () => {
  it("scores a tight, heading-aligned match as high confidence", () => {
    const chosen = candidate({ perpendicularDistanceMeters: 3, headingDeltaDegrees: 2 });
    const result = scoreDirectionConfidence(chosen, [chosen], null);
    expect(result.confidence).toBeGreaterThan(0.8);
    expect(result.isLowConfidence).toBe(false);
  });

  it("flags a far-off-route match as low confidence rather than silently trusting it", () => {
    const chosen = candidate({ perpendicularDistanceMeters: 200, headingDeltaDegrees: null });
    const result = scoreDirectionConfidence(chosen, [chosen], null);
    expect(result.isLowConfidence).toBe(true);
    expect(result.reasons).toContain("off_route_distance");
    // Still returns a confidence value - callers persist it, they don't drop the row.
    expect(result.confidence).toBeGreaterThanOrEqual(0);
  });

  it("returns zero confidence, flagged, when there are no candidates at all", () => {
    const result = scoreDirectionConfidence(null, [], null);
    expect(result).toEqual({ confidence: 0, isLowConfidence: true, reasons: ["no_candidates"] });
  });

  it("penalizes an ambiguous match between two near-equidistant candidates", () => {
    const chosen = candidate({ routeDirectionId: "rd-1", perpendicularDistanceMeters: 10 });
    const runnerUp = candidate({ routeDirectionId: "rd-2", perpendicularDistanceMeters: 12 });
    const unambiguousResult = scoreDirectionConfidence(
      candidate({ routeDirectionId: "rd-1", perpendicularDistanceMeters: 10 }),
      [candidate({ routeDirectionId: "rd-1", perpendicularDistanceMeters: 10 })],
      null
    );
    const ambiguousResult = scoreDirectionConfidence(chosen, [chosen, runnerUp], null);
    expect(ambiguousResult.reasons).toContain("ambiguous_direction");
    expect(ambiguousResult.confidence).toBeLessThan(unambiguousResult.confidence);
  });

  it("rewards continuity with the previously matched direction under ambiguity", () => {
    const chosen = candidate({ routeDirectionId: "rd-1", perpendicularDistanceMeters: 10 });
    const runnerUp = candidate({ routeDirectionId: "rd-2", perpendicularDistanceMeters: 12 });
    const withoutContinuity = scoreDirectionConfidence(chosen, [chosen, runnerUp], null);
    const withContinuity = scoreDirectionConfidence(chosen, [chosen, runnerUp], "rd-1");
    expect(withContinuity.confidence).toBeGreaterThan(withoutContinuity.confidence);
  });

  it("LOW_CONFIDENCE_THRESHOLD is the exact boundary isLowConfidence uses", () => {
    const chosen = candidate({ perpendicularDistanceMeters: 74, headingDeltaDegrees: null });
    const result = scoreDirectionConfidence(chosen, [chosen], null);
    expect(result.isLowConfidence).toBe(result.confidence < LOW_CONFIDENCE_THRESHOLD);
  });
});

describe("selectChosenCandidate", () => {
  it("picks the best candidate when unambiguous", () => {
    const best = candidate({ routeDirectionId: "rd-1", perpendicularDistanceMeters: 2 });
    const worse = candidate({ routeDirectionId: "rd-2", perpendicularDistanceMeters: 50 });
    expect(selectChosenCandidate([best, worse], null)!.routeDirectionId).toBe("rd-1");
  });

  it("prefers the previous direction over a near-tied new best (hysteresis)", () => {
    const best = candidate({ routeDirectionId: "rd-1", perpendicularDistanceMeters: 10 });
    const runnerUp = candidate({ routeDirectionId: "rd-2", perpendicularDistanceMeters: 11 });
    expect(selectChosenCandidate([best, runnerUp], "rd-2")!.routeDirectionId).toBe("rd-2");
  });

  it("does not apply hysteresis when the gap is not ambiguous", () => {
    const best = candidate({ routeDirectionId: "rd-1", perpendicularDistanceMeters: 5 });
    const runnerUp = candidate({ routeDirectionId: "rd-2", perpendicularDistanceMeters: 80 });
    expect(selectChosenCandidate([best, runnerUp], "rd-2")!.routeDirectionId).toBe("rd-1");
  });

  it("returns null for an empty candidate list", () => {
    expect(selectChosenCandidate([], null)).toBeNull();
  });
});
