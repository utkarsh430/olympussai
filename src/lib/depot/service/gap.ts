import { HOURS_PER_DAY } from '../sim/hourlyDemandConfig';
import type { Coverage } from '../types';
import { busesNeeded } from './need';
import {
  MIN_SLOTS_FOR_AN_HOUR,
  type HourBasis,
  type ModelledRouteHour,
  type NeedInputs,
  type ObservedDepotHour,
  type ObservedRouteHour,
  type RouteHourDemand,
  type RouteHourFigures,
  type ScheduledRouteHour,
} from './types';

/** The route as the current snapshot shows it, placed in the feed clock's hour (LIVE). */
export interface CurrentRouteHour {
  readonly hour: number;
  /** Buses carrying the route name now in service or on the road; standing buses are not deployed. */
  readonly deployed: number;
  readonly delayMedianMin: number | null;
  readonly lateShare: number | null;
  readonly delayCoverage: Coverage;
}

export interface RouteHourFiguresInput {
  /** This route's observed hours; an hour under MIN_SLOTS_FOR_AN_HOUR counts as not observed. */
  readonly observed: readonly ObservedRouteHour[];
  /** This route's modelled deployment, for the hours not observed. */
  readonly modelled: readonly ModelledRouteHour[];
  readonly current: CurrentRouteHour | null;
  readonly scheduled: readonly ScheduledRouteHour[];
  /** 24 modelled demand hours of this route. */
  readonly demand: readonly RouteHourDemand[];
  readonly need: NeedInputs;
}

const NO_COVERAGE: Coverage = { n: 0, of: 0 };
const TENTHS = 10;

const oneDecimal = (x: number): number => Math.round(x * TENTHS) / TENTHS;

function byHour<T extends { readonly hour: number }>(rows: readonly T[]): ReadonlyMap<number, T> {
  return new Map(rows.map((r) => [r.hour, r] as const));
}

interface Deployment {
  readonly deployed: number;
  readonly basis: HourBasis;
  readonly delayMedianMin: number | null;
  readonly lateShare: number | null;
  readonly delayCoverage: Coverage;
}

/** The live figure in the feed clock's hour, else an observed hour, else the modelled day. */
function deploymentAt(
  hour: number,
  current: CurrentRouteHour | null,
  observed: ObservedRouteHour | undefined,
  modelled: ModelledRouteHour | undefined,
): Deployment {
  if (current !== null && current.hour === hour) {
    return { ...current, deployed: oneDecimal(current.deployed), basis: 'current' };
  }
  if (observed !== undefined && observed.slotsObserved >= MIN_SLOTS_FOR_AN_HOUR) {
    return {
      deployed: oneDecimal(observed.deployedMean),
      basis: 'observed',
      delayMedianMin: observed.delayMedianMin,
      lateShare: observed.lateShare,
      delayCoverage: observed.delayCoverage,
    };
  }
  return {
    deployed: oneDecimal(modelled?.deployed ?? 0),
    basis: 'modelled',
    delayMedianMin: null,
    lateShare: null,
    delayCoverage: NO_COVERAGE,
  };
}

/**
 * One route's day, every layer side by side for each of the 24 hours: deployed
 * (live in the current hour, observed where this server saw enough slots,
 * modelled otherwise), scheduled bus-hours where any trip is known (null where
 * none is), modelled demand, the buses that demand needs, and the gap (needed
 * minus deployed; positive is short).
 */
export function routeHourFigures(input: Readonly<RouteHourFiguresInput>): RouteHourFigures[] {
  const routeName = input.need.routeName;
  const observed = byHour(input.observed.filter((o) => o.routeName === routeName));
  const modelled = byHour(input.modelled.filter((m) => m.routeName === routeName));
  const scheduled = byHour(input.scheduled.filter((s) => s.routeName === routeName));
  const demand = byHour(input.demand);
  return Array.from({ length: HOURS_PER_DAY }, (_, hour) => {
    const seen = observed.get(hour);
    const d = deploymentAt(hour, input.current, seen, modelled.get(hour));
    const s = scheduled.get(hour);
    const dem = demand.get(hour);
    const boardings = dem?.boardings ?? 0;
    const needed = busesNeeded(boardings, input.need);
    return {
      hour,
      deployed: d.deployed,
      deployedBasis: d.basis,
      slotsObserved: seen?.slotsObserved ?? 0,
      scheduled: s === undefined ? null : oneDecimal(s.busHours),
      scheduledTripsStarting: s?.tripsStarting ?? null,
      demand: boardings,
      demandBand: dem?.band ?? { low: 0, high: 0 },
      needed,
      gap: oneDecimal(needed - d.deployed),
      delayMedianMin: d.delayMedianMin,
      lateShare: d.lateShare,
      delayCoverage: d.delayCoverage,
    };
  });
}

/**
 * The hours the route runs at all: any hour a layer deployed a bus in. This
 * only marks where modelled demand may fall; it never shapes it.
 */
export function activeHoursOf(
  observed: readonly ObservedRouteHour[],
  modelled: readonly ModelledRouteHour[],
  current: CurrentRouteHour | null,
): number[] {
  const hours = new Set<number>([
    ...observed.filter((o) => o.deployedMean > 0).map((o) => o.hour),
    ...modelled.filter((m) => m.deployed > 0).map((m) => m.hour),
    ...(current !== null && current.deployed > 0 ? [current.hour] : []),
  ]);
  return [...hours].sort((a, b) => a - b);
}

/**
 * True when the operating depot had at least as many buses on the road without
 * a route name, on average over the hour, as the route is short: those buses
 * may be running the route without reporting it, so the gap may not be real.
 */
export function unroutedCoverGuard(gap: number, depotHour: ObservedDepotHour | null): boolean {
  if (depotHour === null || !(gap > 0)) return false;
  return depotHour.unroutedOnRoadMean >= gap;
}
