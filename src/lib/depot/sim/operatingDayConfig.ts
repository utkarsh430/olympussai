import type { ServiceClass } from './types';

/*
 * Planning assumptions of the modelled operating day. None is a measurement:
 * the live feed carries no timetable and, until a route's stops are fetched,
 * no route length.
 */

/**
 * Typical one-way length of a route in kilometres, by class, used only while a
 * route has no real profile. Basis: a duty is one run out and back, and the
 * midpoints (115, 165, 170 and 210 km) make that round trip equal the day's
 * running the fuel model assumed before (230, 330, 340 and 420 km): town and
 * rural ordinary services shortest, intercity premium coaches longest. A
 * planning assumption, replaced route by route as real profiles are cached.
 */
export const TYPICAL_ROUTE_LENGTH_KM: Readonly<
  Record<ServiceClass, { readonly from: number; readonly to: number }>
> = {
  ordinary: { from: 70, to: 160 },
  express: { from: 110, to: 220 },
  ac: { from: 115, to: 225 },
  premium: { from: 150, to: 270 },
};

/** Seeds a route's modelled length by its name alone, so it is the same on every date. */
export const ROUTE_LENGTH_SALT = 'route-length';

/**
 * A real length under this is not taken as known; the modelled figure is used
 * and the route counts as modelled. Basis: two located stops a few hundred
 * metres apart give a "length" of a fraction of a kilometre, while the
 * shortest town service out of a depot runs several kilometres; 2 km sits
 * below any real route and above that noise.
 */
export const MIN_REAL_LENGTH_KM = 2;

/** A real length beyond this is a corrupt value, not a route; the modelled figure is used. */
export const MAX_REAL_LENGTH_KM = 2000;
