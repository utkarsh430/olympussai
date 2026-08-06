// Transit Signal Priority (TSP) eligibility stub (blueprint 8.7
// "Conditional transit signal priority": "Request priority based on
// headway gap rather than schedule lateness. Only use where an authorized
// signal interface exists and intersection safety remains external to
// Olympuss AI"; Appendix E Phase 5 "Conditional TSP integration").
//
// This module computes the REQUEST PAYLOAD a signal-priority request
// would carry - it never makes a network/vendor call. Wiring an actual
// signal-interface adapter is out of scope until a route has an
// authorized interface (tracked separately); until then this stub lets
// eligibility logic be exercised, unit-tested, and reviewed in isolation
// from any live traffic-signal integration.
export interface TspEligibilityInput {
  vehicleId: string;
  routeDirectionId: string;
  /** Configured signal-interface identifier for the intersection/control point the vehicle is approaching. */
  intersectionId: string;
  /** epsilon(i) = h_fwd - H* for the vehicle right now (Appendix A "headway deviation"). Positive means the vehicle is running a wider-than-target gap behind its leader (gapped); negative means bunched too close. */
  headwayDeviationSeconds: number | null;
  /** route policy flag: true only when this route-direction/intersection has an authorized external signal interface (blueprint 8.7's hard precondition). */
  hasAuthorizedSignalInterface: boolean;
  /** From the same freshness check the hard safety filter applies (src/mpc/safety.ts) - a stale vehicle position must not drive a signal request either. */
  isStateStale: boolean;
}

export interface TspRequestPayload {
  vehicleId: string;
  routeDirectionId: string;
  intersectionId: string;
  requestedPriority: 'conditional';
  headwayDeviationSeconds: number;
  reason: string;
  generatedAt: string;
}

export interface TspEligibilityResult {
  eligible: boolean;
  reasons: string[];
  /** Non-null only when `eligible` is true. Callers must not send this anywhere until a real signal-interface adapter exists - this module never dispatches it itself. */
  requestPayload: TspRequestPayload | null;
}

/**
 * A bus qualifies for a conditional priority request when it is running
 * gapped (positive headway deviation) beyond this floor - aiding a bus
 * that is already ahead of target would work against headway regularity,
 * not for it, so only the "aid a gapped bus" case (8.1 table) is eligible.
 */
export const MIN_GAPPED_DEVIATION_SECONDS = 60;

export function evaluateTspEligibility(input: TspEligibilityInput): TspEligibilityResult {
  const reasons: string[] = [];

  if (!input.hasAuthorizedSignalInterface) {
    reasons.push('no_authorized_signal_interface');
  }
  if (input.isStateStale) {
    reasons.push('stale_state');
  }
  if (input.headwayDeviationSeconds === null) {
    reasons.push('headway_deviation_unknown');
  } else if (input.headwayDeviationSeconds < MIN_GAPPED_DEVIATION_SECONDS) {
    reasons.push('not_gapped');
  }

  if (reasons.length > 0) {
    return { eligible: false, reasons, requestPayload: null };
  }

  // Reachable only when headwayDeviationSeconds is a number (the
  // `headway_deviation_unknown` reason above rules out null), but TS can't
  // narrow across the loop - assert it explicitly instead of `!`.
  const deviation = input.headwayDeviationSeconds;
  if (deviation === null) {
    // Unreachable given the checks above; kept as a defensive fallback so
    // this function can never return eligible:true with a null deviation.
    return { eligible: false, reasons: ['headway_deviation_unknown'], requestPayload: null };
  }

  return {
    eligible: true,
    reasons: [],
    requestPayload: {
      vehicleId: input.vehicleId,
      routeDirectionId: input.routeDirectionId,
      intersectionId: input.intersectionId,
      requestedPriority: 'conditional',
      headwayDeviationSeconds: deviation,
      reason: 'headway_gap',
      generatedAt: new Date().toISOString(),
    },
  };
}
