import { TENTH } from '@/lib/depot/units';

/**
 * The depot module's rounding rules, beside the robust statistics they serve. Each rule
 * keeps the exact arithmetic its callers have always used: `Math.round` rounds a half up
 * (towards positive infinity), so -0.25 to one decimal is -0.2, not -0.3; only
 * `roundHalfAwayFromZero` is symmetric for rises and falls.
 */

/** `value` to `decimals` places, a half rounded up. */
export function roundToDecimals(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** `value` to one decimal place, a half rounded up. */
export function roundOneDecimal(value: number): number {
  return Math.round(value * TENTH) / TENTH;
}

/** `value` as a whole number of tenths (12.34 is 123), a half rounded up; -0 is kept. */
export function wholeTenths(value: number): number {
  return Math.round(value * TENTH);
}

/**
 * Rounds half away from zero, symmetric for rises and falls. The first pass
 * to six places strips binary noise, so 0.805 - 0.8 (0.50000000000000044 pp)
 * and its mirror both round the same way. Never returns -0.
 */
export function roundHalfAwayFromZero(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const cleaned = Number((Math.abs(value) * factor).toFixed(6));
  const rounded = (Math.sign(value) * Math.round(cleaned)) / factor;
  return rounded === 0 ? 0 : rounded;
}
