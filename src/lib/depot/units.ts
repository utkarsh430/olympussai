/**
 * Time and distance units the depot module converts between, in one place so that every
 * page and engine file reads the same value under the same name. Plain numbers: this file
 * imports nothing.
 */

/** Milliseconds in a second. */
export const MS_PER_SECOND = 1_000;

/** Milliseconds in a minute. */
export const MS_PER_MINUTE = 60_000;

/** Milliseconds in a day. */
export const MS_PER_DAY = 86_400_000;

/** Minutes in an hour. */
export const MINUTES_PER_HOUR = 60;

/** Minutes in a day. */
export const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

/** Metres in a kilometre. */
export const METRES_PER_KM = 1000;

/** The factor for rounding to one decimal place: `Math.round(x * TENTH) / TENTH`. */
export const TENTH = 10;
