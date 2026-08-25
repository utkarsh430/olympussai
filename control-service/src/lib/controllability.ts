// Where a corridor sits on the controllability curve: how much running-time
// deviation accumulates between two stations, as a fraction of the headway a
// hold at either of them is trying to protect.
//
// ─── WHY THIS IS THE FIRST THING TO READ IN ANY RESULT ───────────────────
//
// Almost every verdict a simulator returns about these control laws is a
// property of the CORRIDOR as much as of the laws. Below the band nothing
// comes apart, so there is no dispersion for holding to remove and a small
// measured improvement is the corridor being healthy. Above it, more
// deviation accumulates between two stops than a hold at either can remove,
// so both arms come apart together and every controller reports a modest
// gain. Only inside the band does the number say anything about the
// algorithm.
//
// ─── ONE FORMULA, ONE PLACE ──────────────────────────────────────────────
//
// It lives in `lib/` for the same reason `lib/dispersion.ts` does: two
// harnesses need it and neither may import the other. `fleetTrial/` reports
// it on every run; `evaluation/` did not compute it at all, so a reader of a
// `sim:run` report could not tell whether a "no effect" verdict was about the
// controller or about a corridor that never bunches. MEASURED on that
// harness's own synthetic corridor: uncontrolled excess wait of 24-30 s
// against a 900 s headway, with the controller reading 48-98% WORSE - which
// is what holding a well-spaced corridor does, and reads as a damning result
// about the laws if nobody says which regime it came from.
export interface ControllabilityInputs {
  /** Distance of each stop along the route, in order, in metres. */
  cumulativeDistanceMeters: readonly number[];
  cruiseSpeedKmph: number;
  /** Running time between stops as a fraction of its mean - `route_links.stddev / mean`. */
  travelTimeVariation: number;
  targetHeadwaySeconds: number;
}

export type ControllabilityBand = 'too_regular' | 'controllable' | 'too_disturbed';

export interface Controllability {
  /** How much one leg's running time varies, in seconds. */
  legTimeSigmaSeconds: number;
  /** The same as a fraction of the target headway. THE number that predicts the result. */
  disturbanceRatio: number;
  band: ControllabilityBand;
  note: string;
}

/**
 * Bounds from the sweep recorded in `docs/FLEET_TRIAL.md`: the excess-wait
 * gain is above 40% between about 0.03 and 0.16 and falls away on both sides.
 */
export const CONTROLLABLE_BAND = { low: 0.03, high: 0.16 } as const;

export function assessControllability(inputs: ControllabilityInputs): Controllability {
  const metersPerSecond = inputs.cruiseSpeedKmph / 3.6;
  // The MEAN leg, not the longest: a corridor's legs are near-uniform here, and
  // the mean is what the accumulated deviation between corrections is driven by.
  const legs = inputs.cumulativeDistanceMeters.map((distance, index) =>
    Math.max(0, distance - (index > 0 ? (inputs.cumulativeDistanceMeters[index - 1] ?? 0) : 0)),
  );
  const meanLegMeters = legs.length > 0 ? legs.reduce((a, b) => a + b, 0) / legs.length : 0;
  const meanLegSeconds = metersPerSecond > 0 ? meanLegMeters / metersPerSecond : 0;
  const legTimeSigmaSeconds = meanLegSeconds * inputs.travelTimeVariation;
  const disturbanceRatio =
    inputs.targetHeadwaySeconds > 0 ? legTimeSigmaSeconds / inputs.targetHeadwaySeconds : 0;

  const band: ControllabilityBand =
    disturbanceRatio < CONTROLLABLE_BAND.low
      ? 'too_regular'
      : disturbanceRatio > CONTROLLABLE_BAND.high
        ? 'too_disturbed'
        : 'controllable';

  const note =
    band === 'too_regular'
      ? 'This corridor barely comes apart between stops, so there is little dispersion for a controller to remove. A small measured improvement here is the corridor being healthy, not the controller being weak.'
      : band === 'too_disturbed'
        ? 'More deviation accumulates between two stops than a hold at either can remove, so both arms come apart together. Expect a modest improvement whatever the controller does, and read the uncontrolled arm before blaming the laws.'
        : 'This corridor is in the band where holding has the most to work with: enough deviation accumulates between stops to be worth correcting, and not so much that a correction is washed out before the next one.';

  return { legTimeSigmaSeconds, disturbanceRatio, band, note };
}
