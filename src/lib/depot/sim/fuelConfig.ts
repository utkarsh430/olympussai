import type { ServiceClass } from './types';

/*
 * The fuel model. Every figure here is a MODELLING ASSUMPTION, not a measurement:
 * the live feed carries no fuel issue or odometer. Each is replaced when the
 * transport department supplies fuel and distance feeds. Distance is not drawn
 * here: it comes from the modelled operating day (see operatingDayConfig).
 */

/**
 * Typical diesel economy in kilometres per litre, by class. Basis: planning
 * figures for heavy diesel buses; the modelled class figure is lower for
 * air-conditioned and premium coaches.
 */
export const FUEL_CLASS_KM_PER_LITRE: Readonly<Record<ServiceClass, number>> = {
  ordinary: 4.8,
  express: 4.6,
  ac: 4.0,
  premium: 3.6,
};

/**
 * Half-width of a bus's lasting per-vehicle factor around its class figure.
 * Seeded by registration only, so one bus is consistently better or worse
 * on every date.
 */
export const FUEL_EFFICIENCY_SPREAD = 0.12;

/** Half-width of the day-to-day noise on top of the per-vehicle factor (daily variation). */
export const FUEL_DAILY_NOISE = 0.03;
