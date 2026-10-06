import { SeededRandom } from '../../simulation/seededRandom';
import type { DepotBusView } from '../api';
import type { Duty } from '../duties/types';
import { compareText } from '../fuel/compare';
import { STATIC_SEED_DATE } from './config';
import { planDay, type DutyPlan } from './dayPlan';
import { classFromRoute } from './fleetMaster';
import {
  MAX_REAL_LENGTH_KM,
  MIN_REAL_LENGTH_KM,
  ROUTE_LENGTH_SALT,
  TYPICAL_ROUTE_LENGTH_KM,
} from './operatingDayConfig';
import type {
  DayIdleBus,
  DayRoute,
  DayRun,
  ModelledDaySummary,
  OperatingDay,
  OperatingDayInput,
  RouteLength,
} from './operatingDayTypes';
import { LEGS_PER_TRIP } from './revenueConfig';
import { seedFor } from './seed';
import type { ModelledBus, ServiceClass } from './types';

const TENTH = 10;
type Match = Omit<DayRun, 'distanceKm'>;

/**
 * A route's one-way length: the real one when its profile is cached and
 * plausible, from MIN_REAL_LENGTH_KM to MAX_REAL_LENGTH_KM (DERIVED), otherwise a whole-kilometre figure typical of its class,
 * seeded by the route name alone so it holds on every date (MODELLED).
 */
export function modelRouteLength(
  routeName: string,
  serviceClass: ServiceClass,
  realLengthKm: number | null | undefined,
): RouteLength {
  if (
    typeof realLengthKm === 'number' &&
    realLengthKm >= MIN_REAL_LENGTH_KM &&
    realLengthKm <= MAX_REAL_LENGTH_KM
  ) {
    return { lengthKm: realLengthKm, lengthProvenance: 'derived' };
  }
  const range = TYPICAL_ROUTE_LENGTH_KM[serviceClass];
  const rng = new SeededRandom(seedFor(routeName, STATIC_SEED_DATE, ROUTE_LENGTH_SALT));
  return { lengthKm: Math.round(rng.float(range.from, range.to)), lengthProvenance: 'modelled' };
}

function isAvailable(view: DepotBusView): boolean {
  return view.state !== 'off_road' && view.state !== 'dark';
}

function routeOf(
  routeName: string,
  duties: readonly Duty[],
  matches: readonly Match[],
  realLengthKm: number | null | undefined,
): DayRoute {
  const serviceClass = classFromRoute(routeName) ?? 'ordinary';
  const length = modelRouteLength(routeName, serviceClass, realLengthKm);
  const roundTripTenths = Math.round(length.lengthKm * LEGS_PER_TRIP * TENTH);
  const own = matches.filter((match) => match.routeName === routeName);
  return {
    routeName,
    serviceClass,
    ...length,
    roundTripTenths,
    duties: duties.filter((duty) => duty.routeName === routeName).length,
    trips: own.length,
    serviceKm: (own.length * roundTripTenths) / TENTH,
    seatsOffered: own.reduce((total, match) => total + match.seats, 0),
  };
}

function toMatch(duty: Duty, bus: ModelledBus): Match {
  return {
    dutyId: duty.id,
    routeName: duty.routeName,
    registrationNumber: bus.registrationNumber,
    dutyClass: duty.serviceClass,
    busClass: bus.serviceClass,
    classMatched: bus.serviceClass === duty.serviceClass,
    seats: bus.seats,
  };
}

/**
 * The depot's one MODELLED day for an operating date (ruling S41), read off
 * the depot's one duty plan (ruling S47): its duties, and for each duty the
 * bus the plan matched to it. A bus with a duty runs its route out and back;
 * every other bus of the plan's fleet does not run and has no distance, so
 * runs + not run = the plan's buses (one per registration). Pure.
 */
export function dayFromPlan(
  depotId: string,
  operatingDate: string,
  planned: DutyPlan,
  realLengthKm: ReadonlyMap<string, number | null>,
): OperatingDay {
  const { duties, buses, fleet } = planned;
  const busOf = new Map(planned.plan.assignments.map((a) => [a.dutyId, a.registrationNumber]));
  const matches = duties.flatMap((duty) => {
    const registration = busOf.get(duty.id) ?? null;
    const bus = registration === null ? undefined : fleet.get(registration);
    return bus ? [toMatch(duty, bus)] : [];
  });
  const routes = [...new Set(duties.map((duty) => duty.routeName))]
    .sort(compareText)
    .map((name) => routeOf(name, duties, matches, realLengthKm.get(name)));
  const tripTenths = new Map(routes.map((route) => [route.routeName, route.roundTripTenths]));
  const runs = matches.map(
    (match): DayRun => ({ ...match, distanceKm: (tripTenths.get(match.routeName) ?? 0) / TENTH }),
  );
  const ran = new Set(runs.map((run) => run.registrationNumber));
  const notRun = buses
    .filter((view) => !ran.has(view.registrationNumber))
    .map((view): DayIdleBus => ({
      registrationNumber: view.registrationNumber,
      reason: isAvailable(view) ? 'no_duty' : 'unavailable',
    }))
    .sort((a, b) => compareText(a.registrationNumber, b.registrationNumber));
  return {
    depotId,
    operatingDate,
    duties,
    routesWithoutDuty: planned.routesWithoutDuty,
    routes,
    runs,
    notRun,
    fleet: buses.length,
    availableBuses: buses.filter(isAvailable).length,
    dutiesWithoutBus: duties.length - runs.length,
    provenance: 'modelled',
  };
}

/**
 * The day for one depot from its raw inputs: the plan, then the day read off
 * it. The views use the same two steps with each held once per snapshot.
 */
export function modelOperatingDay(input: OperatingDayInput): OperatingDay {
  const planned = planDay({
    depot: input.depot,
    buses: input.buses,
    peakRequirement: input.peakRequirement,
    operatingDate: input.operatingDate,
    yardEstablished: input.yardEstablished ?? true,
    feedMinute: input.feedMinute ?? null,
  });
  return dayFromPlan(input.depot.id, input.operatingDate, planned, input.realLengthKm);
}

/** The counts every modelled page states about the day it is built on. */
export function summariseDay(day: OperatingDay): ModelledDaySummary {
  return {
    duties: day.duties.length,
    routes: day.routes.length,
    busesRan: day.runs.length,
    buses: day.fleet,
    dutiesWithoutBus: day.dutiesWithoutBus,
  };
}
