import type { ServiceClass } from '../sim/types';

/*
 * Modelling parameters for preventive maintenance. Every value here is an
 * assumption standing in for the maintenance system, which the feed does not
 * carry; the page shows the results tagged MODELLED and the owner can read the
 * values in the report that accompanies this module.
 */

/** Distance between preventive services, per service class (modelled km). */
export const SERVICE_INTERVAL_KM: Readonly<Record<ServiceClass, number>> = {
  ordinary: 10_000,
  express: 12_000,
  ac: 8_000,
  premium: 8_000,
};

/** Typical distance a bus of each class runs in a year (modelled km). */
export const ANNUAL_KM_BY_CLASS: Readonly<Record<ServiceClass, number>> = {
  ordinary: 60_000,
  express: 85_000,
  ac: 70_000,
  premium: 90_000,
};

/** Per-bus spread around the class's annual distance. */
export const ANNUAL_KM_VARIATION = { min: 0.85, max: 1.15 } as const;

/**
 * Distance run since the last service is drawn from zero up to this multiple
 * of the interval, so a share of the fleet is past due and the rest is not.
 */
export const SERVICE_WINDOW_RATIO = 1.1;

/** A bus within this distance of its next service is "due soon". */
export const DUE_SOON_WITHIN_KM = 1_500;

/** Modelled distances are rounded to this step; the model is not that exact. */
export const DISTANCE_STEP_KM = 100;

export const SERVICE_SEED_SALT = 'service-history';
