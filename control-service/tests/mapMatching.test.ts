import { describe, expect, it } from "vitest";
import { matchCandidates } from "../src/state-estimation/mapMatching.js";
import { offsetEastNorth, ORIGIN, straightLinePoints, makeShape } from "./helpers.js";

describe("matchCandidates", () => {
  const eastbound = makeShape({
    routeDirectionId: "rd-east",
    directionCode: "UP",
    points: straightLinePoints(ORIGIN, 1000, 100),
  });
  // A parallel road 40m north, travelled westbound (opposite heading) -
  // simulates an out-and-back route where both directions run close
  // together but in opposite senses.
  const westboundPoints = straightLinePoints(offsetEastNorth(ORIGIN, 0, 40), 1000, 100).reverse();
  const westbound = makeShape({
    routeDirectionId: "rd-west",
    directionCode: "DOWN",
    points: westboundPoints,
  });

  it("ranks the geometrically closer candidate first when no heading is given", () => {
    const point = offsetEastNorth(ORIGIN, 300, 5); // 5m from eastbound, 35m from westbound
    const [best, second] = matchCandidates(point, [eastbound, westbound], null);
    expect(best!.routeDirectionId).toBe("rd-east");
    expect(second!.routeDirectionId).toBe("rd-west");
    expect(best!.perpendicularDistanceMeters).toBeLessThan(second!.perpendicularDistanceMeters);
  });

  it("uses heading to break a near-tie between two close, oppositely-travelled candidates", () => {
    // Roughly equidistant from both lines (~20m from each), heading east.
    const point = offsetEastNorth(ORIGIN, 300, 20);
    const [best] = matchCandidates(point, [eastbound, westbound], 90);
    expect(best!.routeDirectionId).toBe("rd-east");

    const [bestWest] = matchCandidates(point, [eastbound, westbound], 270);
    expect(bestWest!.routeDirectionId).toBe("rd-west");
  });

  it("returns candidates for every shape supplied, sorted best-first", () => {
    const point = offsetEastNorth(ORIGIN, 300, 5);
    const candidates = matchCandidates(point, [westbound, eastbound], null);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]!.perpendicularDistanceMeters).toBeLessThanOrEqual(
      candidates[1]!.perpendicularDistanceMeters
    );
  });
});
