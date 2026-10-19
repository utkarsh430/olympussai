import { CITY_MINUTES, DAY_TO_MIN, SEAT_TURNOVER } from './config';
import type { BusParams, SchedRoute, ServicePriority, Timetable, Trip } from './types';

/*
 * The departures a timetable needs under a set of planning parameters: in each service
 * hour, enough departures to carry the hour's forecast at the target load, and never
 * fewer than the frequency floor. Each departure is a round trip back to its terminal.
 */

const PEAK_HOURS: ReadonlySet<number> = new Set([7, 8, 9, 17, 18, 19]);
/** A route whose round trip is longer than this departs every few hours, not hourly. */
const FLOOR_CYCLE_MIN = 240;
const PRIORITY_BOOST = 1.5;

const hhmm = (min: number): string => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}${String(min % 60).padStart(2, '0')}`;

/** Forecast passengers in an hour after the forecast change. */
export function forecastAt(route: SchedRoute, hour: number, demandPct: number): number {
  return Math.round((route.demand[hour] ?? 0) * (1 + demandPct / 100));
}

/** Hours a long route's departures are spaced: one window of the forecast per departure slot. */
export function windowHours(route: SchedRoute): number {
  return route.cycleMin > FLOOR_CYCLE_MIN ? Math.ceil(route.cycleMin / FLOOR_CYCLE_MIN) : 1;
}

/** Forecast passengers a departure slot starting in this hour carries (its whole window). */
export function slotPassengers(route: SchedRoute, hour: number, demandPct: number): number {
  let sum = 0;
  for (let h = hour; h < hour + windowHours(route) && h <= route.toHour; h += 1) sum += forecastAt(route, h, demandPct);
  return sum;
}

/**
 * Departures a route needs in one hour: the forecast at the target load, never below the
 * frequency floor. A long route departs every few hours and carries the whole window's
 * forecast; a short one departs every hour.
 */
export function departuresInHour(route: SchedRoute, hour: number, params: Pick<BusParams, 'demandPct' | 'targetLoad' | 'minPerHour'>): number {
  if (hour < route.fromHour || hour > route.toHour) return 0;
  if ((hour - route.fromHour) % windowHours(route) !== 0) return 0;
  const passengers = slotPassengers(route, hour, params.demandPct);
  const perDeparture = route.seats * params.targetLoad * SEAT_TURNOVER;
  return Math.max(params.minPerHour, Math.ceil(passengers / perDeparture));
}

function weightOf(route: SchedRoute, hour: number, passengers: number, priority: ServicePriority): number {
  if (priority === 'peak' && PEAK_HOURS.has(hour)) return passengers * PRIORITY_BOOST;
  if (priority === 'intercity' && route.serviceClass !== 'ordinary') return passengers * PRIORITY_BOOST;
  return passengers;
}

/** Every departure the included routes need, by departure time. */
export function tripsFor(timetable: Timetable, params: BusParams): Trip[] {
  const include = params.routes.length === 0 ? null : new Set(params.routes);
  const trips: Trip[] = [];
  for (const route of timetable.routes) {
    if (include && !include.has(route.id)) continue;
    for (let hour = route.fromHour; hour <= route.toHour; hour += 1) {
      const n = departuresInHour(route, hour, params);
      if (n === 0) continue;
      const passengers = slotPassengers(route, hour, params.demandPct);
      const span = windowHours(route) * 60;
      for (let i = 0; i < n; i += 1) {
        const dep = hour * 60 + Math.floor(((i + 0.5) * span) / n / 5) * 5;
        const arr = dep + route.cycleMin;
        if (arr > DAY_TO_MIN + CITY_MINUTES * 6) continue;
        const each = Math.round(passengers / n);
        trips.push({
          id: `${route.id}@${hhmm(dep)}`,
          routeId: route.id,
          serviceClass: route.serviceClass,
          dep,
          arr,
          terminal: route.terminal,
          passengers: each,
          weight: weightOf(route, hour, each, params.priority),
          km: route.oneWayKm * 2,
        });
      }
    }
  }
  return trips.sort((a, b) => a.dep - b.dep || b.weight - a.weight || a.id.localeCompare(b.id));
}

/** The most departures out at once (each held for the turnaround after it returns). */
export function peakConcurrency(trips: readonly Pick<Trip, 'dep' | 'arr'>[], turnaroundMin: number): number {
  const events: [number, number][] = [];
  for (const t of trips) {
    events.push([t.dep, 1], [t.arr + turnaroundMin, -1]);
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let now = 0;
  let peak = 0;
  for (const [, d] of events) {
    now += d;
    peak = Math.max(peak, now);
  }
  return peak;
}
