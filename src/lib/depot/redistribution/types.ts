/*
 * AI Redistribution Engine: the shared shapes. The scenario is the data layer (replaced by
 * ticketing, GPS, scheduling and fleet feeds later, behind the same shape); the plan is
 * what the engine recommends over it; everything on the page is derived from the two.
 */

export const HOURS_PER_DAY = 24;

export type RouteServiceClass = 'ordinary' | 'express' | 'ac';

export interface ScenarioDepot {
  /** One to six digits, so the page's `?depot=` address keeps the module's id rule. */
  readonly id: string;
  readonly name: string;
  /** The three-letter depot code printed on a route identifier. */
  readonly code: string;
  readonly fleet: number;
  /** Road kilometres to every other depot, by id. */
  readonly distanceKm: Readonly<Record<string, number>>;
}

export interface ScenarioRoute {
  /** "LKO-BBK-12": depot code, destination code, number. */
  readonly id: string;
  readonly depotId: string;
  readonly destination: string;
  readonly serviceClass: RouteServiceClass;
  readonly seats: number;
  /** One-way journey time in minutes. */
  readonly journeyMin: number;
  /** Hours a bus needs for one round trip and its layover. */
  readonly cycleHours: number;
  /** Kilometres from the depot yard to the route's city terminal (repositioning distance). */
  readonly terminalKm: number;
  /** 24 entries each, hour 00 first. */
  readonly demand: readonly number[];
  readonly required: readonly number[];
  readonly available: readonly number[];
}

export interface Scenario {
  readonly depots: readonly ScenarioDepot[];
  readonly routes: readonly ScenarioRoute[];
}

/** The page's selection: one depot or all, and an inclusive hour window. */
export interface Selection {
  readonly depotId: string | null;
  readonly fromHour: number;
  readonly toHour: number;
}

export type Feasibility = 'high' | 'medium' | 'low';

export interface Recommendation {
  readonly id: string;
  readonly ordinal: number;
  readonly fromRouteId: string;
  readonly toRouteId: string;
  readonly fromDepotId: string;
  readonly toDepotId: string;
  readonly buses: number;
  /** Repositioning in minutes from midnight. */
  readonly repositionStartMin: number;
  readonly repositionEndMin: number;
  readonly repositionMin: number;
  /** The target hours served, inclusive. */
  readonly targetFromHour: number;
  readonly targetToHour: number;
  /** Bus-hours of shortage closed on the destination. */
  readonly gapBusHours: number;
  /** Passengers the moved buses carry over the target window. */
  readonly passengersServed: number;
  /** Destination coverage over the target window before and after, 0 to 1. */
  readonly coverageBefore: number;
  readonly coverageAfter: number;
  readonly feasibility: Feasibility;
  readonly reason: string;
}

export type UnresolvedReason = 'no_surplus' | 'surplus_exhausted' | 'out_of_reach';

export interface UnresolvedShortage {
  readonly routeId: string;
  readonly depotId: string;
  /** The hours still short, and the largest shortage among them. */
  readonly hours: readonly number[];
  readonly peakShortage: number;
  readonly busHours: number;
  readonly reason: UnresolvedReason;
}

/** Buses available per route after the plan, keyed by route id (24 entries each). */
export type AvailabilityGrid = ReadonlyMap<string, readonly number[]>;

export interface RedistributionPlan {
  readonly selection: Selection;
  readonly recommendations: readonly Recommendation[];
  /** Shortage cells the full plan still leaves short. */
  readonly unresolved: readonly UnresolvedShortage[];
}

/** The figures of one selection, before or after a plan. */
export interface NetworkMetrics {
  readonly routes: number;
  readonly routesShort: number;
  readonly routesSurplus: number;
  readonly shortageBusHours: number;
  readonly surplusBusHours: number;
  /** The most buses short at any one hour of the window, across routes. */
  readonly peakSimultaneousShortage: number;
  readonly peakSimultaneousSurplus: number;
  /** The hour of the peak shortage, null when nothing is short. */
  readonly peakShortageHour: number | null;
  readonly demand: number;
  /** Passengers the allocation can carry, by hour cover. */
  readonly demandCovered: number;
  /** 0 to 1. */
  readonly coverage: number;
  /** Demand-weighted mean passenger wait in minutes, from each hour's headway. */
  readonly meanWaitMin: number;
}
