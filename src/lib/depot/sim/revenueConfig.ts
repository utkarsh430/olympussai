import type { ServiceClass } from './types';

/*
 * The ridership and revenue model. Every figure here is a PLANNING ASSUMPTION,
 * not the corporation's data: the live feed carries no ticketing, so boardings,
 * fares and revenue are MODELLED. Each is replaced when the transport
 * department supplies ticketing data.
 *
 * HOW THE FIGURES RELATE (read this before showing two of them together)
 *  - A trip is a run out and back from the depot: two legs. Its service
 *    kilometres are twice the route length.
 *  - The load factor is occupied seat-kilometres over seat-kilometres, so on
 *    one leg occupied seats = seats x load factor, whatever the length.
 *  - A boarding rides AVG_TRIP_LENGTH_SHARE of the route length on average, so a
 *    leg carries seats x load factor / AVG_TRIP_LENGTH_SHARE boardings (whole
 *    people, floored). Seats turn over along the way, so boardings can exceed
 *    the seats offered while the load factor stays under its cap.
 *  - The fare is per occupied seat-kilometre for the class. Revenue per leg on a
 *    route of known length = seats x load factor x length x fare per km.
 *    On a route of unknown length each boarding pays FLAT_FARE_PER_BOARDING and
 *    earnings per kilometre are withheld.
 *  - Hence earnings per service kilometre = seats x load factor x fare per km,
 *    independent of length. At the base load factor and the class seat count
 *    (52, 44, 40, 45): ordinary about Rs 35.5, express Rs 36.3, ac Rs 39.6,
 *    premium Rs 50.4. The modelled fuel cost per kilometre beside it
 *    (Rs 92 a litre over the class economy) is about Rs 19.2, 20.0, 23.0 and
 *    25.6, so a depot at a typical load shows a margin over fuel, not a loss.
 *    A test pins the ordering for every class.
 */

/**
 * Typical share of seats filled across a trip, by class. Basis: round-number
 * planning figures; ordinary town and rural services run fuller than
 * air-conditioned and premium coaches, which are priced for fewer riders.
 */
export const LOAD_FACTOR_BASE: Readonly<Record<ServiceClass, number>> = {
  ordinary: 0.62,
  express: 0.55,
  ac: 0.45,
  premium: 0.4,
};

/**
 * Half-width of a route's lasting factor around its class base, as a share of
 * the base. Seeded by route name alone, so one route is consistently busier or
 * quieter on every date.
 */
export const LOAD_FACTOR_ROUTE_SPREAD = 0.25;

/** Half-width of the day-to-day noise on top of the route factor, as a share. */
export const LOAD_FACTOR_DAILY_NOISE = 0.05;

/**
 * Hard ceiling on a modelled load factor. A bus is seldom carrying more than
 * its seats and a standing allowance on a trip-average basis; the cap keeps
 * boardings inside what the seats can plausibly carry.
 */
export const MAX_LOAD_FACTOR = 0.95;

/**
 * Average fare per occupied seat-kilometre in rupees, by class. Basis: round
 * planning figures; fares rise from ordinary to premium service.
 */
export const FARE_PER_KM: Readonly<Record<ServiceClass, number>> = {
  ordinary: 1.1,
  express: 1.5,
  ac: 2.2,
  premium: 2.8,
};

/**
 * Share of a route's end-to-end length the average boarding rides. Basis:
 * passengers join and leave along the way, so most ride well under the whole
 * route.
 */
export const AVG_TRIP_LENGTH_SHARE = 0.45;

/**
 * Average fare per boarding in rupees on a route whose length is unknown.
 * Basis: a round planning figure for a short-to-medium ordinary journey.
 */
export const FLAT_FARE_PER_BOARDING = 45;

/**
 * A run is out and back: a trip starts and ends at the depot, so one trip is
 * two legs and covers the route length twice. Used for service kilometres and
 * for the boardings and revenue of a day.
 */
export const LEGS_PER_TRIP = 2;

/** A length beyond this is a corrupt value, not a route; it is treated as unknown. */
export const MAX_PLAUSIBLE_LENGTH_KM = 2000;

/** Seats beyond this per bus are a corrupt value, not a bus. */
export const MAX_SEATS_PER_BUS = 150;

export const ROUTE_FACTOR_SALT = 'ridership-route';
export const DAILY_NOISE_SALT = 'ridership-day';

/**
 * Printed with the revenue response: a route's buses can be of several
 * classes, but one route is priced as one class.
 */
export const MIXED_CLASS_NOTE =
  'A route with buses of several classes is priced at its most numerous class (ties go to the more specific class); its seats are the average across its buses.';

/**
 * Earnings per kilometre enter the Depot Economics Index only when they rest
 * on at least this share of the depot's routes (one quarter): a figure from
 * one route in twenty says little about the depot. Both this and
 * ECONOMICS_MIN_ROUTES must hold.
 */
export const ECONOMICS_MIN_ROUTE_COVERAGE = 0.25;

/** ...and on at least this many routes, so a depot with a single route is never ranked on it. */
export const ECONOMICS_MIN_ROUTES = 2;

/** Weights of the Depot Economics Index components; they sum to 1 (a test asserts it). */
export const ECONOMICS_WEIGHTS = {
  earningsPerKm: 0.4,
  costPerKm: 0.35,
  loadFactor: 0.25,
} as const;

/**
 * The robust z-score at which a component of the economics index stops
 * counting for more: a weighted total of +ECONOMICS_Z_CLAMP reaches 100 and its
 * negative reaches 0. Owned here, not borrowed from the efficiency index, so a
 * change to that index's scale cannot move this one. The breakdown note is
 * built from it.
 */
export const ECONOMICS_Z_CLAMP = 3;

/** The parameters as one value, sent with every response that shows a modelled revenue figure. */
export const REVENUE_MODEL_PARAMS = {
  loadFactorBase: LOAD_FACTOR_BASE,
  routeSpread: LOAD_FACTOR_ROUTE_SPREAD,
  dailyNoise: LOAD_FACTOR_DAILY_NOISE,
  maxLoadFactor: MAX_LOAD_FACTOR,
  farePerKm: FARE_PER_KM,
  avgTripLengthShare: AVG_TRIP_LENGTH_SHARE,
  flatFarePerBoarding: FLAT_FARE_PER_BOARDING,
  legsPerTrip: LEGS_PER_TRIP,
} as const;
