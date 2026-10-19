import { haversineKm, SeededRandom } from '../../../simulation/seededRandom';
import { SEATS_BY_CLASS, STATIC_SEED_DATE } from '../../sim/config';
import { HOUR_SHAPE_BY_CLASS } from '../../sim/hourlyDemandConfig';
import { seedFor } from '../../sim/seed';
import type { ServiceClass } from '../../sim/types';
import type { LatLng } from '../../types';
import { CITY_MINUTES, DAY_TO_MIN, DEFAULT_BUS_PARAMS, LAYOVER_MIN, ROAD_FACTOR, SEAT_TURNOVER, SPEED_KMH } from './config';
import { tripsFor, windowHours } from './trips';
import type { SchedBus, SchedRoute, Timetable } from './types';
import { optimiseBuses } from './vehicles';

/*
 * A depot's timetable for the scheduling engine: its routes (to the real nearby depots'
 * towns and around its own city), each route's class and running time, and the hourly
 * passenger forecast. The route set is fixed for a depot; the forecast varies a little by
 * operating date. Scenario data, seeded, so the bus scheduler, the crew scheduler and the
 * joint optimiser all plan the same day. The forecast is sized against the depot's own
 * buses of each class, so a plan is tight but possible.
 */

export interface TimetableInput {
  readonly depot: { readonly id: string; readonly name: string; readonly centroid: LatLng | null };
  readonly neighbours: readonly { readonly name: string; readonly centroid: LatLng | null }[];
  /** Buses of the depot by class, from its roster. */
  readonly busesByClass: Readonly<Partial<Record<ServiceClass, number>>>;
  readonly operatingDate: string;
}

const LOCAL_DESTINATIONS: readonly { readonly name: string; readonly code: string }[] = [
  { name: 'City Circular', code: 'CIR' },
  { name: 'Railway Station', code: 'RLY' },
  { name: 'Medical College', code: 'MED' },
  { name: 'Industrial Area', code: 'IND' },
  { name: 'University', code: 'UNI' },
  { name: 'Bypass Chauraha', code: 'BYP' },
];
const TERMINALS = ['Main bus stand', 'City terminal', 'Bypass terminal'] as const;
/** Same-city depots are not intercity destinations. */
const SAME_CITY_KM = 15;
const MAX_ROUTE_KM = 210;
/** A route serves every hour from 05:00 to 22:00 unless its cycle ends past the day. */
const SERVICE_HOURS = { from: 5, to: 22 } as const;
/**
 * Share of each class's buses the forecast needs under the default plan, seeded per
 * depot. Off-road, overdue and reserve buses take about a fifth of a fleet, so the
 * tightest depots end a little short and the rest have a margin.
 */
const TIGHTNESS = { min: 0.64, max: 0.78 } as const;
const CALIBRATION_STEPS = 9;
const DAILY_JITTER = 0.08;

/** A route class the depot's buses can serve: premium coaches run the AC routes. */
const ROUTE_CLASS_OF: Readonly<Record<ServiceClass, ServiceClass>> = { ordinary: 'ordinary', express: 'express', ac: 'ac', premium: 'ac' };

export function depotCode(name: string): string {
  const words = name.toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'DPT';
  if (words.length === 1) return words[0]!.slice(0, 3).padEnd(3, 'X');
  return `${words[0]!.slice(0, 2)}${words[1]![0]}`;
}

const titleCase = (name: string): string => name.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const round5 = (n: number): number => Math.max(5, Math.round(n / 5) * 5);

interface Destination {
  readonly name: string;
  readonly code: string;
  readonly km: number;
  readonly local: boolean;
}

function destinations(input: TimetableInput, rng: SeededRandom): Destination[] {
  const from = input.depot.centroid;
  const towns = new Map<string, Destination>();
  for (const n of input.neighbours) {
    if (!from || !n.centroid) continue;
    const km = haversineKm(from.lat, from.lng, n.centroid.lat, n.centroid.lng) * ROAD_FACTOR;
    if (km < SAME_CITY_KM || km > MAX_ROUTE_KM) continue;
    const code = depotCode(n.name);
    if (!towns.has(code)) towns.set(code, { name: titleCase(n.name), code, km: Math.round(km), local: false });
  }
  const intercity = [...towns.values()].sort((a, b) => a.km - b.km).slice(0, 12);
  const local = LOCAL_DESTINATIONS.map((d) => ({ ...d, km: rng.int(9, 22), local: true }));
  return [...intercity, ...local];
}

/**
 * Each route class gets routes in proportion to the depot's buses that can run it (at
 * least one when it has any), the coach classes on the longest routes.
 */
function classPlan(dests: readonly Destination[], busesByClass: TimetableInput['busesByClass']): ServiceClass[] {
  const buses = { ordinary: 0, express: 0, ac: 0, premium: 0 } as Record<ServiceClass, number>;
  for (const [cls, n] of Object.entries(busesByClass)) buses[ROUTE_CLASS_OF[cls as ServiceClass]] += n ?? 0;
  const fleet = buses.ordinary + buses.express + buses.ac;
  const total = dests.length;
  const quota = (cls: ServiceClass): number => (buses[cls] === 0 ? 0 : Math.max(1, Math.round((total * buses[cls]) / Math.max(1, fleet))));
  const ac = quota('ac');
  const express = Math.min(quota('express'), total - ac);
  // Longest intercity routes first take the coach classes; city routes stay ordinary.
  const order = dests.map((d, i) => ({ i, km: d.local ? -1 : d.km })).sort((a, b) => b.km - a.km || a.i - b.i);
  const classes: ServiceClass[] = dests.map(() => 'ordinary');
  order.forEach(({ i, km }, rank) => {
    if (km < 0) return;
    if (rank < ac) classes[i] = 'ac';
    else if (rank < ac + express) classes[i] = 'express';
  });
  if (buses.ordinary === 0) return classes.map((c) => (c === 'ordinary' ? (buses.express > 0 ? 'express' : 'ac') : c));
  return classes;
}

/** The routes and their running times; demand is filled in by the caller. */
function routeSkeleton(input: TimetableInput, total: number): SchedRoute[] {
  const rng = new SeededRandom(seedFor(input.depot.id, STATIC_SEED_DATE, 'sched-routes'));
  const dests = destinations(input, rng);
  const code = depotCode(input.depot.name);
  const intercity = dests.filter((d) => !d.local);
  const local = dests.filter((d) => d.local);
  // About one route in three is a city route when the depot has intercity towns at all.
  const chosen = Array.from({ length: total }, (_, i) => (intercity.length === 0 || (i % 3 === 2 && local.length > 0) ? local[i % local.length]! : intercity[i % intercity.length]!));
  const classes = classPlan(chosen, input.busesByClass);
  const routes: SchedRoute[] = [];
  const count = new Map<string, number>();
  for (let i = 0; i < total; i += 1) {
    const dest = chosen[i]!;
    const n = (count.get(dest.code) ?? 0) + 1;
    count.set(dest.code, n);
    const serviceClass = classes[i]!;
    const journeyMin = round5((dest.km / SPEED_KMH[serviceClass]) * 60 + CITY_MINUTES);
    const cycleMin = journeyMin * 2 + LAYOVER_MIN * 2;
    const lastHour = Math.min(SERVICE_HOURS.to, Math.floor((DAY_TO_MIN + 60 - cycleMin) / 60));
    routes.push({
      id: `${code}-${dest.code}-${String(n).padStart(2, '0')}`,
      destination: dest.name,
      serviceClass,
      seats: SEATS_BY_CLASS[serviceClass],
      oneWayKm: dest.km,
      journeyMin,
      cycleMin,
      terminal: dest.local ? rng.int(1, 2) : rng.int(0, 1),
      demand: [],
      fromHour: SERVICE_HOURS.from,
      toHour: Math.max(SERVICE_HOURS.from, lastHour),
    });
  }
  return routes;
}

/** The forecast factor at which a class's busiest slot fills about two thirds of one departure. */
function floorFactor(routes: readonly SchedRoute[], bases: readonly (readonly number[])[]): number {
  let factor = Number.POSITIVE_INFINITY;
  routes.forEach((route, i) => {
    const perDeparture = route.seats * DEFAULT_BUS_PARAMS.targetLoad * SEAT_TURNOVER;
    const peak = Math.max(...slotSums(route, bases[i]!));
    if (peak > 0) factor = Math.min(factor, (perDeparture * 0.66) / peak);
  });
  return Number.isFinite(factor) ? factor : 0;
}

function slotSums(route: SchedRoute, base: readonly number[]): number[] {
  const out: number[] = [];
  for (let h = route.fromHour; h <= route.toHour; h += windowHours(route)) out.push(base.slice(h, h + windowHours(route)).reduce((s, v) => s + v, 0));
  return out;
}

/**
 * The depot's timetable for an operating date: its routes and a forecast that needs
 * about seven to eight tenths of each class's buses under the default plan.
 */
export function buildTimetable(input: TimetableInput): Timetable {
  const fleet = Object.values(input.busesByClass).reduce((s, n) => s + (n ?? 0), 0);
  const total = Math.min(20, Math.max(4, Math.round(fleet / 6)));
  const skeleton = routeSkeleton(input, total);
  const staticRng = new SeededRandom(seedFor(input.depot.id, STATIC_SEED_DATE, 'sched-demand'));
  const dayRng = new SeededRandom(seedFor(input.depot.id, input.operatingDate, 'sched-demand-day'));
  const tightness = staticRng.float(TIGHTNESS.min, TIGHTNESS.max);
  const base = skeleton.map((route) => {
    const daily = staticRng.int(900, 2600) * (route.serviceClass === 'ordinary' ? 1 : 0.7);
    const shape = HOUR_SHAPE_BY_CLASS[route.serviceClass];
    return shape.map((share) => daily * share * (1 + dayRng.float(-DAILY_JITTER, DAILY_JITTER)));
  });

  // For each class, the largest forecast the class's target share of buses can carry
  // under the default plan, found by halving: the optimiser itself is the measure.
  const scale = new Map<ServiceClass, number>();
  for (const cls of ['ordinary', 'express', 'ac'] as const) {
    const fleet = Object.entries(input.busesByClass).reduce((s, [c, n]) => s + (ROUTE_CLASS_OF[c as ServiceClass] === cls ? (n ?? 0) : 0), 0);
    const indices = skeleton.flatMap((r, i) => (r.serviceClass === cls ? [i] : []));
    if (indices.length === 0 || fleet === 0) continue;
    const buses: SchedBus[] = Array.from({ length: Math.max(1, Math.round(fleet * tightness)) }, (_, i) => ({
      registration: `${cls}-${i}`,
      serviceClass: cls,
      state: 'standing',
      risk: 0,
      serviceDueInDays: 1,
      restriction: null,
    }));
    const carries = (factor: number): boolean => {
      const routes = indices.map((i) => ({ ...skeleton[i]!, demand: base[i]!.map((v) => v * factor) }));
      const timetable: Timetable = { depotId: input.depot.id, depotCode: '', operatingDate: input.operatingDate, routes, terminalKm: [3, 6, 9], terminalNames: [] };
      const params = { ...DEFAULT_BUS_PARAMS, objective: 'min_buses' as const };
      return optimiseBuses(timetable, tripsFor(timetable, params), buses, params).uncovered.length === 0;
    };
    let low = 0;
    let high = 4;
    for (let step = 0; step < CALIBRATION_STEPS; step += 1) {
      const mid = (low + high) / 2;
      if (carries(mid)) low = mid;
      else high = mid;
    }
    // A class short even at its frequency floor keeps a forecast that fills those departures.
    scale.set(cls, low > 0 ? low : floorFactor(indices.map((i) => skeleton[i]!), indices.map((i) => base[i]!)));
  }
  const routes = skeleton.map((r, i) => ({ ...r, demand: base[i]!.map((v) => Math.round(v * (scale.get(r.serviceClass) ?? 1))) }));
  const terminalRng = new SeededRandom(seedFor(input.depot.id, STATIC_SEED_DATE, 'sched-terminals'));
  return {
    depotId: input.depot.id,
    depotCode: depotCode(input.depot.name),
    operatingDate: input.operatingDate,
    routes,
    terminalKm: [terminalRng.int(2, 4), terminalRng.int(4, 8), terminalRng.int(7, 12)],
    terminalNames: TERMINALS,
  };
}
