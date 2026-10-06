import type { ServiceClass } from './types';

/*
 * The ridership and revenue model. Every figure here is a PLANNING ASSUMPTION,
 * not the corporation's data: the live feed carries no ticketing, so boardings,
 * fares and revenue are MODELLED. Each is replaced when the transport
 * department supplies ticketing data.
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
 * Average fare per passenger-kilometre in rupees, by class. Basis: round
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
 * A run is out and back: a trip starts and ends at the depot, so one trip
 * covers the route length twice. Used for service kilometres.
 */
export const LEGS_PER_TRIP = 2;

/** A length beyond this is a corrupt value, not a route; it is treated as unknown. */
export const MAX_PLAUSIBLE_LENGTH_KM = 2000;

/** Seats beyond this per bus are a corrupt value, not a bus. */
export const MAX_SEATS_PER_BUS = 150;

export const ROUTE_FACTOR_SALT = 'ridership-route';
export const DAILY_NOISE_SALT = 'ridership-day';

/** Weights of the Depot Economics Index components; they sum to 1 (a test asserts it). */
export const ECONOMICS_WEIGHTS = {
  earningsPerKm: 0.4,
  costPerKm: 0.35,
  loadFactor: 0.25,
} as const;

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
