// The dwell half of the arrival model - the part that is NOT measured.
//
// Travel time in this subsystem is measured distance divided by measured speed.
// Dwell is not: this service has no dwell history to measure from, because
// `vehicle_states` is a current-state table by design and there is no telemetry
// time series in this schema
// (control-service/db/migrations/20260805190000__core_data_model.sql, which says
// so in as many words).
//
// The one dwell signal the live table does carry - `now() - stop_state_entered_at`
// for vehicles currently dwelling - is a CENSORED sample: it measures how long a
// dwell has lasted SO FAR, only for dwells that have not finished, which
// systematically under-reports short dwells and over-reports nothing. Calibrating
// a dwell model from it would produce a number with a real derivation and a
// wrong value, which is worse than a constant that says it is a constant.
//
// So: a named configured constant, reported on the wire as
// `dwell.measured: false`, with its contribution to every arrival broken out
// separately in `components.dwellSeconds` so anyone who wants only the measured
// part can subtract it.

import type { CurrentStopDwellBasis, DwellModel } from './types.js';

/**
 * Seconds charged for each intermediate stop between the vehicle and the stop
 * being predicted.
 *
 * 45 s is a wayside halt on an intercity working: doors, a handful of boardings
 * and alightings, no ticketing queue. It is CONFIGURATION, not a measurement of
 * these stops, and it is deliberately in the middle of the plausible range
 * rather than at either end, because it is wrong in both directions and biasing
 * it would only choose which direction to be wrong in more often.
 *
 * Its influence is bounded by construction: with a median inter-stop spacing of
 * 7.9 km, a bus reaching its third stop ahead has travelled about 24 km, which
 * at any plausible running speed dominates the 90 s of modelled dwell it has
 * been charged. Dwell error cannot be the main term in these numbers.
 */
export const DEFAULT_DWELL_SECONDS = 45;

/**
 * How uncertain the dwell constant is, as a fraction of itself.
 *
 * Folded into the arrival bounds so the band widens with the number of stops
 * being crossed rather than pretending the constant is exact. 0.6 means a
 * modelled 45 s stop is bounded at 18-72 s.
 */
export const DWELL_UNCERTAINTY_FRACTION = 0.6;

export interface CurrentStopDwellInput {
  /** `vehicle_states.stop_state`. */
  stopState: string;
  /** `vehicle_states.stop_state_entered_at`, ISO-8601 or null. */
  stopEnteredAt: string | null;
  /** `vehicle_states.observed_at` as epoch ms - elapsed is measured to the OBSERVATION, not to now. */
  observedAtMs: number;
  dwellSeconds?: number;
}

export interface CurrentStopDwell {
  basis: CurrentStopDwellBasis;
  remainingSeconds: number;
}

/**
 * How much dwell is left to serve at the stop the vehicle is at right now.
 *
 * Only `dwelling_at_stop` has a dwell to finish. `approaching_stop` has not
 * started one (its dwell is charged as an intermediate stop if the predicted
 * stop is beyond it); `departed_stop`, `stopped_in_traffic` and `off_route`
 * have none. `held_by_controller` never reaches here - the caller refuses the
 * whole prediction, because when a held bus departs is a controller's decision
 * rather than an inference from its position.
 */
export function computeCurrentStopDwell(input: CurrentStopDwellInput): CurrentStopDwell {
  const dwellSeconds = input.dwellSeconds ?? DEFAULT_DWELL_SECONDS;

  if (input.stopState !== 'dwelling_at_stop') {
    return { basis: 'not_at_stop', remainingSeconds: 0 };
  }

  if (input.stopEnteredAt === null) {
    return { basis: 'dwell_elapsed_unknown', remainingSeconds: dwellSeconds };
  }

  const enteredAtMs = Date.parse(input.stopEnteredAt);
  if (Number.isNaN(enteredAtMs)) {
    return { basis: 'dwell_elapsed_unknown', remainingSeconds: dwellSeconds };
  }

  const elapsedSeconds = (input.observedAtMs - enteredAtMs) / 1000;
  // A negative elapsed means the vehicle entered the stop AFTER the fix that
  // observed it dwelling there. That is not a short dwell, it is two timestamps
  // that disagree, and charging a full dwell rather than clamping to zero keeps
  // the disagreement from reading as "about to leave".
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
    return { basis: 'dwell_elapsed_unknown', remainingSeconds: dwellSeconds };
  }

  return {
    basis: 'observed_dwell_elapsed',
    remainingSeconds: Math.max(0, dwellSeconds - elapsedSeconds),
  };
}

export function describeDwellModel(currentStop: CurrentStopDwell, dwellSeconds = DEFAULT_DWELL_SECONDS): DwellModel {
  return {
    basis: 'configured_default',
    measured: false,
    secondsPerIntermediateStop: dwellSeconds,
    currentStop,
  };
}
