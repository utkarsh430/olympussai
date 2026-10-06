/*
 * The trip-frequency model.
 *
 * The feed says which buses carry a route name now, never how often the route
 * runs. Dead kilometres are charged per trip that starts from and returns to
 * the operating depot (depot to first stop, last stop back), so a "trip" here
 * is that depot-anchored run, not every revenue journey between terminals. It
 * is modelled from the live figures so it cannot contradict them: every bus
 * seen on the route today made at least one such run, and a route short enough
 * to bring its buses back for a midday break made two. A seeded per-route,
 * per-day variation stands in for the timetable. Labelled MODELLED on screen;
 * replaced when a network timetable is supplied.
 */

/**
 * Depot-anchored runs per bus per day. One is the floor: a bus seen on the
 * route left its depot at least once today. Two is a split duty, the most a
 * depot roster gives one bus in a day.
 */
export const TRIP_FACTOR_RANGE = { min: 1, max: 2 } as const;

/**
 * Scheduled end-to-end minutes at or below which a route's buses are taken to
 * work a split duty (two runs): a short urban or suburban route fits two
 * spells around a depot break inside a working day.
 */
export const SHORT_ROUTE_MIN = 90;

/**
 * Scheduled minutes at or above which a route's buses make one run a day: an
 * eight-hour intercity journey fills a crew's duty on its own. Between the
 * two bounds the factor falls linearly.
 */
export const LONG_ROUTE_MIN = 480;

/** With no scheduled duration (route not yet profiled), the midpoint of the range. */
export const UNKNOWN_DURATION_FACTOR = 1.5;

/** Half-width of the seeded per-route, per-day variation, as a share of the factor. */
export const TRIP_FACTOR_NOISE = 0.15;

/**
 * A duration beyond a day is not one trip; it is treated as unknown. Bounds
 * hostile or corrupt upstream values before they reach the arithmetic.
 */
export const MAX_PLAUSIBLE_DURATION_MIN = 1440;

/**
 * More buses than this on one route name is a feed error, not a route; the
 * count is capped so the product stays a small finite integer.
 */
export const MAX_BUSES_PER_ROUTE = 500;

/** Salt of the seeded stream, so it is independent of every other modelled figure. */
export const TRIP_FREQUENCY_SALT = 'trip-frequency';

/** The parameters as one value, sent with every response that shows a modelled trip count. */
export interface TripModelParams {
  readonly factorMin: number;
  readonly factorMax: number;
  readonly shortRouteMin: number;
  readonly longRouteMin: number;
  readonly unknownDurationFactor: number;
  readonly noise: number;
}

export const TRIP_MODEL_PARAMS: TripModelParams = {
  factorMin: TRIP_FACTOR_RANGE.min,
  factorMax: TRIP_FACTOR_RANGE.max,
  shortRouteMin: SHORT_ROUTE_MIN,
  longRouteMin: LONG_ROUTE_MIN,
  unknownDurationFactor: UNKNOWN_DURATION_FACTOR,
  noise: TRIP_FACTOR_NOISE,
};
