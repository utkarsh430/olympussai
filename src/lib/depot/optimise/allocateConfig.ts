/**
 * Smallest daily saving worth a planner's attention. Below it a move is noise
 * on a modelled figure and not worth the disruption of re-rostering a route.
 */
export const MIN_SAVING_KM_PER_DAY = 5;

/** Bound on applied moves across both phases, so a plan stays reviewable by a person. */
export const MAX_MOVES = 200;

/** Metres in a kilometre. */
export const METRES_PER_KM = 1000;

/**
 * Daily costs are held as whole metres rounded to a tenth of a kilometre, so
 * before, after and every move's saving are integers on the same grid and
 * their one-decimal kilometre forms add up exactly.
 */
export const COST_GRID_M = 100;

/**
 * Largest trips-per-day figure a route may carry and still be costed. A day has
 * 1,440 minutes, so ten thousand trips is far beyond any real timetable yet
 * small enough that metres times trips stays an exact integer. Above it the
 * figure is a data error and the route is left uncostable.
 */
export const MAX_TRIPS_PER_DAY = 10_000;

/**
 * Largest number of buses one route may need and still be costed. No route
 * fields a hundred thousand buses (a whole state fleet is of that order), so a
 * larger figure is a data error and the route is left uncostable.
 */
export const MAX_BUSES = 100_000;
