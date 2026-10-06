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
