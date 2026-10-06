import type { ServiceClass } from './types';

/*
 * The hourly demand and need model. Every figure here is a PLANNING ASSUMPTION
 * (REFERENCE), not the corporation's data: the feed carries no ticketing, so
 * when passengers travel in the day is MODELLED. The owner may edit any of
 * these; each is replaced when ticket times arrive.
 */

export const HOURS_PER_DAY = 24;

/** Scales raw weights so the 24 sum to exactly 1, the last absorbing rounding. */
function toShape(raw: readonly number[]): readonly number[] {
  const total = raw.reduce((sum, w) => sum + w, 0);
  const shares = raw.map((w) => w / total);
  const head = shares.slice(0, -1);
  return [...head, 1 - head.reduce((sum, w) => sum + w, 0)];
}

/*
 * Hour-of-day shapes per class: the share of a day's boardings in each hour,
 * 00:00 first. Basis: round-number planning shapes. Ordinary town and rural
 * services carry commuters, so two peaks near 08:00 and 18:00; express
 * (intercity) services fill at a morning departure peak with a smaller evening
 * one; air-conditioned and premium coaches are booked through the day, so
 * flatter. Night hours keep a small weight so a night service is never empty.
 */
export const HOUR_SHAPE_BY_CLASS: Readonly<Record<ServiceClass, readonly number[]>> = {
  //            00 01 02 03 04 05 06  07  08  09 10 11 12 13 14 15 16 17  18  19 20 21 22 23
  ordinary: toShape([1, 1, 1, 1, 2, 4, 7, 10, 12, 9, 6, 5, 5, 5, 5, 6, 8, 10, 11, 8, 5, 3, 2, 1]),
  express: toShape([1, 1, 1, 2, 4, 8, 11, 12, 10, 8, 6, 5, 5, 5, 5, 6, 7, 8, 8, 7, 5, 4, 3, 2]),
  ac: toShape([1, 1, 1, 1, 2, 4, 6, 7, 8, 8, 7, 7, 6, 6, 6, 7, 7, 8, 8, 7, 6, 4, 3, 2]),
  premium: toShape([1, 1, 1, 1, 2, 4, 6, 7, 8, 8, 7, 7, 6, 6, 6, 7, 7, 8, 8, 7, 6, 4, 3, 2]),
};

/** A journey longer than this (minutes) is a long route: its passengers board at departure. */
export const LONG_ROUTE_JOURNEY_MIN = 240;

/*
 * Where a long route's boardings lean: early-morning departures and the
 * evening and overnight departures typical of long intercity services. Basis:
 * on a long route most passengers board at the start of a journey, so demand
 * follows departure hours rather than the commuting day.
 */
export const LONG_ROUTE_DEPARTURE_SHAPE: readonly number[] = toShape([
  2, 1, 1, 2, 6, 10, 11, 9, 6, 4, 3, 3, 3, 3, 3, 3, 4, 5, 6, 7, 8, 7, 5, 3,
]);

/** How far a long route's shape moves toward the departure shape (0 none, 1 all the way). */
export const LONG_ROUTE_LEAN = 0.4;

/** The hours a route runs when nothing says otherwise: 05:00 to 22:59 (inclusive bounds). */
export const DEFAULT_ACTIVE_HOURS = { from: 5, to: 22 } as const;

/**
 * Fewer marked active hours than this are too few to describe a route's day (a
 * cold server, a route seen briefly), so the default daytime is used instead.
 */
export const MIN_SERVICE_HOURS = 4;

/** Half-width of the seeded per-hour jitter on the shape, as a share. */
export const HOURLY_JITTER = 0.08;

/**
 * Half-width of the band drawn around each hour's modelled demand, as a share.
 * Matches the lasting per-route spread of the ridership model, the largest
 * uncertainty the model carries.
 */
export const DEMAND_BAND_SHARE = 0.25;

/** Salt of the hourly demand stream, so it is independent of every other modelled figure. */
export const HOURLY_DEMAND_SALT = 'hourly-demand';

/** What modelled hourly demand rests on, printed beside it. */
export const DEMAND_BASIS =
  "Modelled from the route's service class and length, anchored to the day's modelled boardings; not ticketing.";

/**
 * Share of seats a bus should fill on the busiest stretch of the route. Basis:
 * a common planning load; fuller than this and boarding slows and passengers
 * are left behind, emptier and the service is wasteful.
 */
export const TARGET_LOAD = 0.75;

/**
 * Share of an hour's boardings on board together over the busiest stretch.
 * Basis: passengers board and alight along the way, so not every boarding
 * needs a seat at the same time; 0.6 is a planning figure for a corridor with
 * turnover.
 */
export const BUSIEST_STRETCH_SHARE = 0.6;

/** Minutes a bus stands at the terminal between journeys. Basis: a planning figure. */
export const LAYOVER_MIN = 15;

/**
 * Operating cost of one bus-kilometre in rupees, all in (fuel, wages,
 * maintenance, tyres, overheads). Basis: a round planning figure for a state
 * road transport bus; the fuel part alone is about Rs 19 to 26 by class
 * (revenueConfig). Replaced when the corporation's cost per km is supplied.
 */
export const COST_PER_BUS_KM = 50;

/** Half-width of every modelled impact range, as a share of its central figure. */
export const IMPACT_RANGE_SHARE = 0.25;
