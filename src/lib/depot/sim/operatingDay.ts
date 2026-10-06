import { SeededRandom } from '../../simulation/seededRandom';
import type { DepotBusView } from '../api';
import type { Duty } from '../duties/types';
import { compareText } from '../fuel/compare';
import { STATIC_SEED_DATE } from './config';
import { modelDuties } from './duties';
import { classFromRoute, modelBus } from './fleetMaster';
import {
  BUS_ORDER_SALT,
  MAX_REAL_LENGTH_KM,
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
 * plausible (DERIVED), otherwise a whole-kilometre figure typical of its class,
 * seeded by the route name alone so it holds on every date (MODELLED).
 */
export function modelRouteLength(
  routeName: string,
  serviceClass: ServiceClass,
  realLengthKm: number | null | undefined,
): RouteLength {
  if (typeof realLengthKm === 'number' && realLengthKm > 0 && realLengthKm <= MAX_REAL_LENGTH_KM) {
    return { lengthKm: realLengthKm, lengthProvenance: 'derived' };
  }
  const range = TYPICAL_ROUTE_LENGTH_KM[serviceClass];
  const rng = new SeededRandom(seedFor(routeName, STATIC_SEED_DATE, ROUTE_LENGTH_SALT));
  return { lengthKm: Math.round(rng.float(range.from, range.to)), lengthProvenance: 'modelled' };
}

function isAvailable(view: DepotBusView): boolean {
  return view.state !== 'off_road' && view.state !== 'dark';
}

/** The available buses in the day's order: a draw per bus and date, so no bus moves another. */
function inDayOrder(buses: readonly DepotBusView[], operatingDate: string): ModelledBus[] {
  return buses
    .map((view) => ({
      bus: modelBus(view.registrationNumber, view.routeName),
      key: new SeededRandom(seedFor(view.registrationNumber, operatingDate, BUS_ORDER_SALT)).float(0, 1),
    }))
    .sort((a, b) => a.key - b.key || compareText(a.bus.registrationNumber, b.bus.registrationNumber))
    .map((entry) => entry.bus);
}

/**
 * Gives each duty, in order, the first bus of its class among those that ran;
 * the duties still open then take the buses left, in order. A duty beyond the
 * buses stays without one.
 */
function matchInOrder(
  duties: readonly Duty[],
  runners: readonly ModelledBus[],
): ReadonlyMap<string, ModelledBus> {
  const taken = new Set<string>();
  const byDuty = new Map<string, ModelledBus>();
  const give = (duty: Duty, bus: ModelledBus | undefined): void => {
    if (!bus) return;
    byDuty.set(duty.id, bus);
    taken.add(bus.registrationNumber);
  };
  const free = (bus: ModelledBus): boolean => !taken.has(bus.registrationNumber);
  for (const duty of duties) {
    give(duty, runners.find((bus) => free(bus) && bus.serviceClass === duty.serviceClass));
  }
  for (const duty of duties) {
    if (!byDuty.has(duty.id)) give(duty, runners.find(free));
  }
  return byDuty;
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
 * The depot's one MODELLED day for an operating date (ruling S41). The duties
 * are `modelDuties`' own; the available buses, in a seeded order that changes
 * with the date, run one duty each, class matched where the buses that ran
 * allow; every other bus did not run and has no distance. A bus that ran
 * covered its duty's route out and back. This is a record of the day and is
 * separate from the duty board's live matching of buses now standing in the
 * yard to duties still to come; both read the same duties. Pure: no clock, no
 * randomness beyond the seeds, and input order never matters.
 */
export function modelOperatingDay(input: OperatingDayInput): OperatingDay {
  const { depot, buses, operatingDate } = input;
  const names = [...new Set(buses.flatMap((b) => (b.routeName ? [b.routeName] : [])))];
  // The feed carries no scheduled durations, exactly as the duty board models them.
  const { duties, routesWithoutDuty } = modelDuties(
    depot,
    names.map((routeName) => ({ routeName, scheduledDurationMin: null })),
    input.peakRequirement,
    operatingDate,
  );
  const available = inDayOrder(buses.filter(isAvailable), operatingDate);
  const byDuty = matchInOrder(duties, available.slice(0, duties.length));
  const matches = duties.flatMap((duty) => {
    const bus = byDuty.get(duty.id);
    return bus ? [toMatch(duty, bus)] : [];
  });
  const routes = [...new Set(duties.map((duty) => duty.routeName))]
    .sort(compareText)
    .map((name) => routeOf(name, duties, matches, input.realLengthKm.get(name)));
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
    depotId: depot.id,
    operatingDate,
    duties,
    routesWithoutDuty,
    routes,
    runs,
    notRun,
    fleet: buses.length,
    availableBuses: available.length,
    dutiesWithoutBus: duties.length - runs.length,
    provenance: 'modelled',
  };
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
