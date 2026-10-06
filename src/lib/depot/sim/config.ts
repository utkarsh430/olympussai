import { DEFAULT_SPARE_RATIO } from '../optimise/config';
import type { RequirementParams, ServiceClass } from './types';

/*
 * The requirement model.
 *
 * The live feed says how many buses a depot has and what they are doing, but
 * not how many it needs. Until a network timetable is supplied, the need is
 * modelled from the live figures so a modelled number can never contradict a
 * live one: a depot whose buses are more on the road than its peers' over the
 * rolling score window is assumed stretched (it needs a larger share of its available fleet), and
 * one with many standing buses is assumed to have slack. A seeded per-depot
 * variation stands in for everything else. This is a model, labelled MODELLED
 * on screen, and it is replaced when a network timetable is supplied.
 */

/** Share of available buses a typical depot needs at peak. */
const DEFAULT_BASE_UTILISATION = 0.86;
/** Moves the requirement by half a point per point of on-road share above peers. */
const DEFAULT_UTILISATION_SENSITIVITY = 0.5;
/** Half-width of the seeded per-depot variation. */
const DEFAULT_NOISE = 0.04;

export const DEFAULT_REQUIREMENT_PARAMS: RequirementParams = {
  spareRatio: DEFAULT_SPARE_RATIO,
  baseUtilisation: DEFAULT_BASE_UTILISATION,
  utilisationSensitivity: DEFAULT_UTILISATION_SENSITIVITY,
  noise: DEFAULT_NOISE,
};

export const SPARE_RATIO_BOUNDS = { min: 0, max: 0.3 } as const;
export const BASE_UTILISATION_BOUNDS = { min: 0.5, max: 1.1 } as const;
export const UTILISATION_SENSITIVITY_BOUNDS = { min: 0, max: 2 } as const;
export const NOISE_BOUNDS = { min: 0, max: 0.2 } as const;

/** A peak share outside this band is not a plausible need for a depot. */
export const PEAK_SHARE_BOUNDS = { min: 0.7, max: 1.12 } as const;

/** Peers are only the depots big enough for their on-road share to mean something. */
export const MIN_PEER_FLEET = 10;

/** Basis points keep the spare-target arithmetic exact. */
export const BASIS_POINTS = 10_000;

/** A depot's yard is sized at fleet times a factor in this range. */
export const PARKING_FACTOR_RANGE = { min: 1.0, max: 1.25 } as const;
export const BUSES_PER_WORKSHOP_BAY = 25;
export const BUSES_PER_FUEL_POINT = 60;

/** Seeds that must not change when the operating date does. */
export const STATIC_SEED_DATE = 'static';

export const ROUTE_TOKEN_CLASS: Readonly<Record<string, ServiceClass>> = {
  ORD: 'ordinary',
  EXP: 'express',
  AC: 'ac',
  VOLVO: 'premium',
  JAN: 'premium',
  SCANIA: 'premium',
};

/**
 * When a route name carries several class tokens the most specific class wins,
 * most specific first: a premium coach on a route also tagged ordinary is still
 * a premium coach.
 */
export const SERVICE_CLASS_PRIORITY: readonly ServiceClass[] = [
  'premium',
  'ac',
  'express',
  'ordinary',
];

/** Fleet mix used when the route name names no class; sums to 1. */
export const SERVICE_CLASS_PROPORTIONS: readonly (readonly [ServiceClass, number])[] = [
  ['ordinary', 0.72],
  ['express', 0.16],
  ['ac', 0.08],
  ['premium', 0.04],
];

export const SEATS_BY_CLASS: Readonly<Record<ServiceClass, number>> = {
  ordinary: 52,
  express: 44,
  ac: 40,
  premium: 45,
};

export const MAX_BUS_AGE_YEARS = 15;
