// Map matching: project a raw GPS fix onto every candidate route-direction
// shape and rank the candidates. Direction *selection* (with hysteresis)
// and confidence scoring live in confidence.ts - this module only produces
// the ranked geometric candidates.

import { angularDifferenceDegrees, projectPointOntoLineString } from "./geometry.js";
import type { LatLng, MapMatchCandidate, RouteDirectionShape } from "./types.js";

/** Heading mismatch penalty, in metres-equivalent, at a full 180 degree delta. */
const HEADING_PENALTY_METERS_AT_180_DEGREES = 50;

export function matchCandidates(
  point: LatLng,
  shapes: readonly RouteDirectionShape[],
  headingDegrees: number | null
): MapMatchCandidate[] {
  const candidates = shapes.map((shape): MapMatchCandidate => {
    const projection = projectPointOntoLineString(point, shape.points);
    const headingDeltaDegrees =
      headingDegrees == null
        ? null
        : angularDifferenceDegrees(headingDegrees, projection.segmentHeadingDegrees);

    return {
      routeDirectionId: shape.routeDirectionId,
      projectedDistanceMeters: projection.distanceAlongLineMeters,
      perpendicularDistanceMeters: projection.perpendicularDistanceMeters,
      headingDeltaDegrees,
      segmentHeadingDegrees: projection.segmentHeadingDegrees,
    };
  });

  return candidates.sort((a, b) => matchScore(a) - matchScore(b));
}

function matchScore(candidate: MapMatchCandidate): number {
  const headingPenalty =
    candidate.headingDeltaDegrees == null
      ? 0
      : (candidate.headingDeltaDegrees / 180) * HEADING_PENALTY_METERS_AT_180_DEGREES;
  return candidate.perpendicularDistanceMeters + headingPenalty;
}
