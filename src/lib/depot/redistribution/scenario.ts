import { SeededRandom } from '@/lib/simulation/seededRandom';
import { HOUR_SHAPE_BY_CLASS, LAYOVER_MIN } from '../sim/hourlyDemandConfig';
import { HOURS_PER_DAY, type RouteServiceClass, type Scenario, type ScenarioDepot, type ScenarioRoute } from './types';

/*
 * The demonstration scenario: eight depots, about 270 routes, each route's passenger
 * demand, buses required and buses allocated for every hour of the day. Seeded, so every
 * render and every visit shows the same network; this module is the only one that knows the
 * figures are generated, and it is what a ticketing, GPS and scheduling adapter replaces.
 */

/** One seed for the whole scenario: the same network on every visit. */
const SCENARIO_SEED = 'ai-redistribution-engine/v1';

/** How full a bus should run on its busiest stretch, and the share of an hour's boardings on board together. */
const TARGET_LOAD = 0.75;
const BUSIEST_STRETCH_SHARE = 0.6;

/** A bus's commitment per departure, in hours, kept to a planning range. */
const CYCLE_HOURS = { min: 0.75, max: 3 } as const;

const SEATS: Readonly<Record<RouteServiceClass, number>> = { ordinary: 52, express: 48, ac: 40 };
const SPEED_KMH: Readonly<Record<RouteServiceClass, number>> = { ordinary: 36, express: 46, ac: 52 };
const DAY_BOARDINGS: Readonly<Record<RouteServiceClass, { readonly min: number; readonly max: number }>> = {
  ordinary: { min: 2200, max: 5600 },
  express: { min: 1400, max: 3400 },
  ac: { min: 600, max: 1500 },
};

/** How closely a route's allocation follows its hourly need: the rest is a flat day-long base. */
const ALLOCATION_FOLLOWS_NEED = 0.55;
/** Fleet held back in the yard beyond the day's peak allocation. */
const FLEET_RESERVE_SHARE = 0.08;

/** The hours an ordinary route runs; a night route runs the whole day. */
const DAY_ACTIVE = { from: 5, to: 22 } as const;
const NIGHT_ROUTE_SHARE = 0.1;

interface DepotSeed {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  /** Below one the depot allocates fewer buses than its routes need; above one, more. */
  readonly fleetFactor: number;
  readonly routes: number;
  readonly destinations: readonly { readonly code: string; readonly km: number }[];
}

const DEPOT_SEEDS: readonly DepotSeed[] = [
  {
    id: '1001', name: 'Lucknow Charbagh', code: 'LKO', fleetFactor: 0.9, routes: 40,
    destinations: [
      { code: 'BBK', km: 32 }, { code: 'SIT', km: 88 }, { code: 'RBL', km: 80 }, { code: 'UNN', km: 62 },
      { code: 'HRD', km: 110 }, { code: 'FZD', km: 128 }, { code: 'KNP', km: 85 }, { code: 'LKM', km: 135 },
      { code: 'GND', km: 118 }, { code: 'SLN', km: 134 }, { code: 'BHR', km: 58 }, { code: 'MLH', km: 46 },
    ],
  },
  {
    id: '1002', name: 'Kanpur Central', code: 'KNP', fleetFactor: 1.03, routes: 36,
    destinations: [
      { code: 'LKO', km: 85 }, { code: 'UNN', km: 24 }, { code: 'KDH', km: 72 }, { code: 'FTP', km: 76 },
      { code: 'ETW', km: 160 }, { code: 'ORA', km: 108 }, { code: 'JHS', km: 220 }, { code: 'HMP', km: 62 },
      { code: 'BND', km: 118 }, { code: 'AKB', km: 52 }, { code: 'BLG', km: 44 },
    ],
  },
  {
    id: '1003', name: 'Agra Fort', code: 'AGR', fleetFactor: 1.1, routes: 32,
    destinations: [
      { code: 'MTH', km: 58 }, { code: 'FZB', km: 36 }, { code: 'ETA', km: 82 }, { code: 'ALG', km: 86 },
      { code: 'MNP', km: 112 }, { code: 'HTR', km: 60 }, { code: 'BHR', km: 92 }, { code: 'KRJ', km: 72 },
      { code: 'ETW', km: 118 }, { code: 'DLI', km: 230 },
    ],
  },
  {
    id: '1004', name: 'Varanasi Cantt', code: 'VNS', fleetFactor: 0.97, routes: 34,
    destinations: [
      { code: 'JNP', km: 60 }, { code: 'MZP', km: 68 }, { code: 'GZP', km: 72 }, { code: 'CHD', km: 44 },
      { code: 'BLA', km: 128 }, { code: 'AZM', km: 94 }, { code: 'PRG', km: 120 }, { code: 'SNB', km: 82 },
      { code: 'BHD', km: 62 }, { code: 'RBT', km: 74 }, { code: 'MAU', km: 100 },
    ],
  },
  {
    id: '1005', name: 'Gorakhpur', code: 'GKP', fleetFactor: 0.92, routes: 32,
    destinations: [
      { code: 'DRA', km: 68 }, { code: 'BST', km: 72 }, { code: 'KSN', km: 54 }, { code: 'MHJ', km: 50 },
      { code: 'AZM', km: 96 }, { code: 'DEO', km: 90 }, { code: 'SIK', km: 44 }, { code: 'SNL', km: 102 },
      { code: 'NTW', km: 92 }, { code: 'KPT', km: 36 },
    ],
  },
  {
    id: '1006', name: 'Prayagraj Civil Lines', code: 'PRG', fleetFactor: 1.06, routes: 34,
    destinations: [
      { code: 'VNS', km: 120 }, { code: 'PBH', km: 60 }, { code: 'MZP', km: 90 }, { code: 'KSB', km: 56 },
      { code: 'FTP', km: 118 }, { code: 'RBL', km: 124 }, { code: 'JNP', km: 100 }, { code: 'CHT', km: 128 },
      { code: 'HND', km: 42 }, { code: 'PHL', km: 48 }, { code: 'SRW', km: 54 },
    ],
  },
  {
    id: '1007', name: 'Meerut Bhainsali', code: 'MRT', fleetFactor: 1.0, routes: 32,
    destinations: [
      { code: 'DLI', km: 72 }, { code: 'GZB', km: 46 }, { code: 'MZN', km: 54 }, { code: 'HPR', km: 36 },
      { code: 'BGP', km: 44 }, { code: 'SHR', km: 112 }, { code: 'BJN', km: 62 }, { code: 'HDR', km: 148 },
      { code: 'MRD', km: 136 }, { code: 'NDA', km: 70 },
    ],
  },
  {
    id: '1008', name: 'Bareilly Satellite', code: 'BLY', fleetFactor: 1.12, routes: 30,
    destinations: [
      { code: 'SHJ', km: 72 }, { code: 'PBT', km: 58 }, { code: 'BDN', km: 46 }, { code: 'RMP', km: 64 },
      { code: 'MRD', km: 92 }, { code: 'HLD', km: 134 }, { code: 'LKM', km: 118 }, { code: 'NTL', km: 140 },
      { code: 'AON', km: 28 }, { code: 'FRD', km: 42 },
    ],
  },
];

/** Road kilometres between depots; a pair not listed is beyond intra-day repositioning. */
const DEPOT_DISTANCE_KM: readonly (readonly [string, string, number])[] = [
  ['1001', '1002', 85],
  ['1001', '1006', 200],
  ['1001', '1008', 250],
  ['1002', '1006', 200],
  ['1004', '1006', 120],
  ['1004', '1005', 200],
  ['1003', '1007', 230],
  ['1007', '1008', 230],
  ['1003', '1008', 220],
];

const FAR_KM = 999;

function distanceTable(id: string): Readonly<Record<string, number>> {
  return Object.fromEntries(
    DEPOT_SEEDS.filter((d) => d.id !== id).map((d) => {
      const pair = DEPOT_DISTANCE_KM.find(([a, b]) => (a === id && b === d.id) || (b === id && a === d.id));
      return [d.id, pair?.[2] ?? FAR_KM] as const;
    }),
  );
}

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

function pickClass(rng: SeededRandom): RouteServiceClass {
  const draw = rng.float(0, 1);
  if (draw < 0.6) return 'ordinary';
  return draw < 0.9 ? 'express' : 'ac';
}

/**
 * A route's structural leaning: most near even; some chronically short; some on a fixed
 * allocation set for their peak, so they hold spare buses through much of the day.
 */
function routeBias(rng: SeededRandom): number {
  const draw = rng.float(0, 1);
  if (draw < 0.12) return rng.float(0.6, 0.74);
  if (draw < 0.32) return rng.float(1.3, 1.6);
  return rng.float(0.92, 1.1);
}

function buildRoute(depot: DepotSeed, index: number): ScenarioRoute {
  const rng = new SeededRandom(`${SCENARIO_SEED}|${depot.id}|${index}`);
  const destination = depot.destinations[index % depot.destinations.length] as DepotSeed['destinations'][number];
  const variant = Math.floor(index / depot.destinations.length) + 1;
  const serviceClass = pickClass(rng);
  const seats = SEATS[serviceClass];
  const journeyMin = Math.round((destination.km / SPEED_KMH[serviceClass]) * 60 * rng.float(0.92, 1.08));
  const cycleHours = clamp((2 * journeyMin + LAYOVER_MIN) / 60, CYCLE_HOURS.min, CYCLE_HOURS.max);
  const boardings = DAY_BOARDINGS[serviceClass];
  const dayBoardings = rng.int(boardings.min, boardings.max);
  const night = rng.bool(NIGHT_ROUTE_SHARE);
  const active = night ? { from: 0, to: 23 } : DAY_ACTIVE;
  const shape = HOUR_SHAPE_BY_CLASS[serviceClass];
  const bias = routeBias(rng);
  const paxPerBusHour = (seats * TARGET_LOAD) / BUSIEST_STRETCH_SHARE / cycleHours;

  const hours = Array.from({ length: HOURS_PER_DAY }, (_, h) => h);
  const demand = hours.map((h) => {
    if (h < active.from || h > active.to) return 0;
    return Math.round(dayBoardings * (shape[h] ?? 0) * rng.float(0.9, 1.1));
  });
  const required = demand.map((pax) => (pax <= 0 ? 0 : Math.max(1, Math.ceil(pax / paxPerBusHour))));
  const activeNeed = required.filter((n) => n > 0);
  const meanNeed = activeNeed.length === 0 ? 0 : activeNeed.reduce((s, n) => s + n, 0) / activeNeed.length;
  const available = required.map((need) => {
    if (need <= 0) return 0;
    const planned = ALLOCATION_FOLLOWS_NEED * need + (1 - ALLOCATION_FOLLOWS_NEED) * meanNeed;
    return Math.max(1, Math.round(planned * depot.fleetFactor * bias));
  });

  return {
    id: `${depot.code}-${destination.code}-${String(variant * 10 + (index % 7)).padStart(2, '0')}`,
    depotId: depot.id,
    destination: destination.code,
    serviceClass,
    seats,
    journeyMin,
    cycleHours,
    terminalKm: rng.fixed(2, 14, 1),
    demand,
    required,
    available,
  };
}

function buildDepot(seed: DepotSeed, routes: readonly ScenarioRoute[]): ScenarioDepot {
  const peakOut = Math.max(
    ...Array.from({ length: HOURS_PER_DAY }, (_, h) => routes.reduce((s, r) => s + (r.available[h] ?? 0), 0)),
  );
  return {
    id: seed.id,
    name: seed.name,
    code: seed.code,
    fleet: Math.round(peakOut * (1 + FLEET_RESERVE_SHARE)),
    distanceKm: distanceTable(seed.id),
  };
}

function build(): Scenario {
  const perDepot = DEPOT_SEEDS.map((seed) => {
    const routes = Array.from({ length: seed.routes }, (_, i) => buildRoute(seed, i));
    return { depot: buildDepot(seed, routes), routes };
  });
  return {
    depots: perDepot.map((d) => d.depot),
    routes: perDepot.flatMap((d) => d.routes),
  };
}

let cached: Scenario | null = null;

/** The one scenario, built on first use and held for the session. */
export function demonstrationScenario(): Scenario {
  if (cached === null) cached = build();
  return cached;
}

export function scenarioDepot(scenario: Scenario, depotId: string): ScenarioDepot | null {
  return scenario.depots.find((d) => d.id === depotId) ?? null;
}

export function depotName(scenario: Scenario, depotId: string): string {
  return scenarioDepot(scenario, depotId)?.name ?? `Depot ${depotId}`;
}

/** The routes of one depot, or every route. */
export function routesOf(scenario: Scenario, depotId: string | null): readonly ScenarioRoute[] {
  return depotId === null ? scenario.routes : scenario.routes.filter((r) => r.depotId === depotId);
}

export function routeById(scenario: Scenario): ReadonlyMap<string, ScenarioRoute> {
  return new Map(scenario.routes.map((r) => [r.id, r] as const));
}

export const SERVICE_CLASS_LABEL: Readonly<Record<RouteServiceClass, string>> = {
  ordinary: 'Ordinary',
  express: 'Express',
  ac: 'Air-conditioned',
};
