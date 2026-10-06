import { UNASSIGNED_DEPOT_ID } from './types';

/**
 * Validation for identifiers that arrive from a URL segment, a query string or
 * a request body. Every depot route and API checks its id here before doing
 * any work, so a hostile value is refused at the door rather than reaching a
 * lookup, a cache key or a response.
 *
 * Both checks take `unknown` on purpose: callers pass values they have not
 * typed yet.
 */

/** Upstream `home_depot` is one to six ASCII digits. */
const DEPOT_ID_PATTERN = /^[0-9]{1,6}$/;

/** Feed route names such as `RKD_4560_ORD_OUT`: letters, digits, `_` and `-`. */
const ROUTE_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidDepotId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return value === UNASSIGNED_DEPOT_ID || DEPOT_ID_PATTERN.test(value);
}

export function isValidRouteName(value: unknown): value is string {
  return typeof value === 'string' && ROUTE_NAME_PATTERN.test(value);
}
