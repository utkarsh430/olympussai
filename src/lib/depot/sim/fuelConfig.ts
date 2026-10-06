import type { ServiceClass } from './types';

/*
 * The fuel model. Every figure here is a MODELLING ASSUMPTION, not a measurement:
 * the live feed carries no fuel issue or odometer. Each is replaced when the
 * transport department supplies fuel and distance feeds.
 */

/**
 * Typical kilometres run by a bus in a day, by class. Basis: round-number
 * planning figures for a state road-transport fleet, longer for coaches that
 * run intercity schedules than for ordinary town and rural services.
 */
export const FUEL_CLASS_DAILY_KM: Readonly<Record<ServiceClass, number>> = {
  ordinary: 230,
  express: 330,
  ac: 340,
  premium: 420,
};

/**
 * Typical diesel economy in kilometres per litre, by class. Basis: planning
 * figures for heavy diesel buses; air-conditioned and premium coaches carry
 * more weight and a compressor load, so they cover fewer kilometres per litre.
 */
export const FUEL_CLASS_KM_PER_LITRE: Readonly<Record<ServiceClass, number>> = {
  ordinary: 4.8,
  express: 4.6,
  ac: 4.0,
  premium: 3.6,
};

/** Half-width of the day-to-day spread in distance, as a share of typical distance. */
export const FUEL_DISTANCE_SPREAD = 0.2;

/** A standing bus runs only a share of a full day (shunting, a part-day turn). */
export const FUEL_STANDING_DISTANCE_SHARE = 0.5;

/**
 * Half-width of a bus's lasting efficiency factor around its class figure.
 * Seeded by registration only, so one bus is consistently better or worse
 * on every date (engine condition, tyres, body weight).
 */
export const FUEL_EFFICIENCY_SPREAD = 0.12;

/** Half-width of the day-to-day noise on top of the lasting factor (load, traffic). */
export const FUEL_DAILY_NOISE = 0.03;

/** Diesel price in rupees per litre used when the caller supplies none. */
export const DEFAULT_PRICE_PER_LITRE = 92;
