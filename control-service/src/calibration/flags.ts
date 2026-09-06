// The switch that lets fitted inputs reach anything, and why it is here.
//
// ─── WHY NOT config/env.ts ───────────────────────────────────────────────
//
// Every other flag in this service is declared in `src/config/env.ts`, and
// this one deliberately is not. That module validates the WHOLE service
// environment at import and throws when `CONTROL_SERVICE_DATABASE_URL`,
// `SERVICE_TOKEN_SECRET` or `WEBHOOK_HMAC_SECRET` are missing - which is
// correct for a service that is booting and wrong for this package, whose
// point is that `buildDwellObservations`, `fitDwellModel`, `fitLinkTravelTimes`,
// `measureDispersion` and the contamination rules are PURE and can be run
// from a test or an ad-hoc `tsx` script with no database and no secrets.
// Importing `config/env.ts` here would make three unrelated service secrets a
// precondition of fitting a straight line, and AGENTS.md records that sharp
// edge as one sessions already trip over.
//
// So the flag is read from `process.env` at CALL time - not captured at
// module load - and every function that acts on it also takes an explicit
// override, so nothing in the fitting path is reachable only through an
// environment variable.
//
// ─── WHY IT IS OFF ───────────────────────────────────────────────────────
//
// Off is byte-identical: with this false `calibrateFromVisits` builds the
// same observations, fits the same models and returns the same numbers it
// returned before this module existed, and `test/evaluation/calibrate.test.ts`
// pins that.
//
// It is off because the exclusions in `calibration/contamination.ts` are
// correct and the DATA IS NOT YET THICK ENOUGH FOR THEM TO PAY. Measured on
// this network's first day of stop visits, no corridor reaches
// `evaluation/calibrate.ts#isCalibrated` either way, and filtering makes the
// thin fits thinner. Turning it on is right the day a corridor clears that
// bar; turning it on today would replace one number nobody should quote with
// a cleaner number nobody should quote.

/** Env var name, stated once so a doc and a shell agree on the spelling. */
export const CONTAMINATION_FILTER_ENV = 'CALIBRATION_CONTAMINATION_FILTER_ENABLED';

/**
 * Whether calibration should exclude contaminated observations before fitting.
 *
 * Accepts the same four spellings `config/env.ts#booleanFromEnv` accepts, so
 * an operator who has set flags on this service before is not surprised.
 * Anything else - including an empty string and a typo - is false: a
 * misspelled flag must leave the default in place rather than silently
 * enabling a different measurement.
 */
export function contaminationFilterEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = environment[CONTAMINATION_FILTER_ENV];
  return raw === 'true' || raw === '1';
}
