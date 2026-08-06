// Trip/direction confidence scoring (AC: "Trip/direction confidence
// scored; low-confidence vehicles flagged, not silently trusted").
//
// Two responsibilities live here:
//  - selectChosenCandidate: which map-match candidate to actually commit
//    to, applying hysteresis so a vehicle doesn't flap between two nearly
//    equidistant candidates (e.g. an out-and-back route where both
//    directions run the same road) on every sample.
//  - scoreDirectionConfidence: how much to trust that choice. Below
//    LOW_CONFIDENCE_THRESHOLD the estimate is flagged via
//    ConfidenceResult.isLowConfidence - callers must persist and propagate
//    that flag rather than treating a low-confidence match the same as a
//    high-confidence one (see ordering.ts, which excludes flagged vehicles
//    from the leader/follower chain rather than silently trusting them).

import { clamp } from "./geometry.js";
import type { ConfidenceResult, MapMatchCandidate } from "./types.js";

export const LOW_CONFIDENCE_THRESHOLD = 0.4;

const OFF_ROUTE_PERPENDICULAR_METERS = 75;
const HIGH_CONFIDENCE_PERPENDICULAR_METERS = 20;
const AMBIGUITY_MARGIN_METERS = 10;
const CONTINUITY_BONUS = 0.15;

export function selectChosenCandidate(
  candidates: readonly MapMatchCandidate[],
  previousRouteDirectionId: string | null
): MapMatchCandidate | null {
  const best = candidates[0];
  if (!best) return null;

  const runnerUp = candidates[1];
  const isAmbiguous =
    !!runnerUp &&
    runnerUp.perpendicularDistanceMeters - best.perpendicularDistanceMeters <
      AMBIGUITY_MARGIN_METERS;

  if (
    isAmbiguous &&
    runnerUp &&
    previousRouteDirectionId === runnerUp.routeDirectionId &&
    previousRouteDirectionId !== best.routeDirectionId
  ) {
    // Ambiguous between two near-equidistant candidates: stick with the
    // previously matched direction instead of flapping on GPS noise alone.
    return runnerUp;
  }

  return best;
}

export function scoreDirectionConfidence(
  chosen: MapMatchCandidate | null,
  candidates: readonly MapMatchCandidate[],
  previousRouteDirectionId: string | null
): ConfidenceResult {
  const reasons: string[] = [];

  if (!chosen) {
    return { confidence: 0, isLowConfidence: true, reasons: ["no_candidates"] };
  }

  if (chosen.perpendicularDistanceMeters > OFF_ROUTE_PERPENDICULAR_METERS) {
    return { confidence: 0.05, isLowConfidence: true, reasons: ["off_route_distance"] };
  }

  let confidence = 1 - chosen.perpendicularDistanceMeters / OFF_ROUTE_PERPENDICULAR_METERS;

  if (chosen.perpendicularDistanceMeters > HIGH_CONFIDENCE_PERPENDICULAR_METERS) {
    reasons.push("marginal_perpendicular_distance");
  }

  if (chosen.headingDeltaDegrees != null) {
    const headingFactor = 1 - chosen.headingDeltaDegrees / 180;
    confidence = confidence * 0.6 + headingFactor * 0.4;
    if (chosen.headingDeltaDegrees > 90) {
      reasons.push("heading_mismatch");
    }
  }

  const runnerUp = candidates.find((c) => c.routeDirectionId !== chosen.routeDirectionId);
  if (runnerUp) {
    const margin = runnerUp.perpendicularDistanceMeters - chosen.perpendicularDistanceMeters;
    if (margin < AMBIGUITY_MARGIN_METERS) {
      reasons.push("ambiguous_direction");
      confidence -= 0.2;
      if (previousRouteDirectionId === chosen.routeDirectionId) {
        confidence += CONTINUITY_BONUS;
        reasons.push("continuity_bonus_applied");
      }
    }
  } else if (previousRouteDirectionId === chosen.routeDirectionId) {
    confidence += CONTINUITY_BONUS / 2;
  }

  confidence = clamp(confidence, 0, 1);
  return { confidence, isLowConfidence: confidence < LOW_CONFIDENCE_THRESHOLD, reasons };
}
