import { FUEL_CLASS_KM_PER_LITRE } from '../../sim/fuelConfig';
import type { ServiceClass } from '../../sim/types';
import { BUS_DAY_FIXED_COST, CREW_COST_PER_HOUR, CREW_RELEASE_GAP_MIN, DIESEL_PRICE, REPOSITION_MIN } from './config';
import { blockOf, measure, repositionKm } from './evaluate';
import { peakConcurrency } from './trips';
import type { BusParams, BusPlan, BusRestriction, Conflict, Objective, SchedBus, Timetable, Trip, UncoveredTrip } from './types';

/*
 * Bus scheduling. The optimiser takes the day's departures in time order and gives each
 * one the bus that suits the objective best among those free in time (after the
 * turnaround, and the move between terminals), of a class that can run it, and within
 * the longest day a bus may work. Buses are shared between routes. Under the coverage
 * objective a heavier departure may displace a lighter one when no bus is free. The
 * baseline is the conventional method: buses fixed to routes in roster order, planned
 * before today's off-road and maintenance status was known.
 */

/** Bus classes that may run a route of each class. */
export const CAN_RUN: Readonly<Record<ServiceClass, readonly ServiceClass[]>> = {
  ordinary: ['ordinary', 'express'],
  express: ['express', 'premium'],
  ac: ['ac', 'premium'],
  premium: ['premium'],
};

export const RESTRICTION_LABEL: Readonly<Record<BusRestriction, string>> = {
  off_road: 'Off road in the feed',
  service_overdue: 'Service overdue',
  high_risk: 'High breakdown risk',
  marked_unavailable: 'Marked unavailable',
  reserve: 'Held in reserve',
};

/** Applies the day's restrictions, then holds the reserve: the lowest-risk buses that are left. */
export function restrictBuses(buses: readonly SchedBus[], params: Pick<BusParams, 'holdOverdue' | 'holdHighRisk' | 'unavailable' | 'reservePct'>): SchedBus[] {
  const marked = new Set(params.unavailable);
  const restricted = buses.map((b): SchedBus => {
    const restriction: BusRestriction | null =
      b.state === 'off_road'
        ? 'off_road'
        : marked.has(b.registration)
          ? 'marked_unavailable'
          : params.holdOverdue && b.serviceDueInDays < 0
            ? 'service_overdue'
            : params.holdHighRisk && b.risk >= 50
              ? 'high_risk'
              : null;
    return { ...b, restriction };
  });
  const free = restricted.filter((b) => b.restriction === null).sort((a, b) => a.risk - b.risk || a.registration.localeCompare(b.registration));
  const reserve = new Set(free.slice(0, Math.round((free.length * params.reservePct) / 100)).map((b) => b.registration));
  return restricted.map((b): SchedBus => (reserve.has(b.registration) ? { ...b, restriction: 'reserve' } : b)).sort((a, b) => a.registration.localeCompare(b.registration));
}

interface BusState {
  readonly bus: SchedBus;
  trips: Trip[];
  freeAt: number;
  terminal: number;
  routeId: string;
  blockStart: number;
}

const fuelPerKm = (cls: ServiceClass): number => DIESEL_PRICE / FUEL_CLASS_KM_PER_LITRE[cls];

/** Cost of giving `trip` to `state` under an objective; lower is better. */
function score(state: BusState, trip: Trip, timetable: Timetable, objective: Objective): number {
  const used = state.trips.length > 0;
  const idle = used ? trip.dep - state.freeAt : 0;
  const switchKm = used ? repositionKm(timetable, state.terminal, trip.terminal) : 0;
  const routeChange = used && state.routeId !== trip.routeId ? 1 : 0;
  const pullKm = used ? 0 : 2 * (timetable.terminalKm[trip.terminal] ?? 0);
  // Among buses already out, the one whose day began first works this departure, so buses
  // that started later keep their hours for the evening.
  const age = used ? (trip.dep - state.blockStart) / 60 : 0;
  return base(objective) - age * 0.5;
  function base(objective: Objective): number {
  switch (objective) {
    case 'min_buses':
      return (used ? 0 : 100_000) + idle * 0.01 + switchKm + routeChange * 0.2;
    case 'min_empty_km':
      return (used ? 0 : 40 + pullKm * 20) + switchKm * 20 + routeChange * 3 + idle * 0.01;
    case 'min_cost': {
      const idleCost = idle < CREW_RELEASE_GAP_MIN ? (idle / 60) * CREW_COST_PER_HOUR : 0;
      return (used ? 0 : BUS_DAY_FIXED_COST + pullKm * fuelPerKm(state.bus.serviceClass)) + idleCost + switchKm * fuelPerKm(state.bus.serviceClass);
    }
    case 'coverage':
      return (used ? 0 : 5) + idle * 0.02 + switchKm * 2 + routeChange * 0.5;
    case 'balanced':
    default:
      return (used ? 0 : 700) + idle * 1.5 + switchKm * 15 + routeChange * 5;
  }
  }
}

function fits(state: BusState, trip: Trip, params: BusParams): boolean {
  if (!CAN_RUN[trip.serviceClass].includes(state.bus.serviceClass)) return false;
  if (state.trips.length === 0) return trip.arr - trip.dep <= params.maxBlockHours * 60;
  const move = state.terminal === trip.terminal ? 0 : REPOSITION_MIN;
  return state.freeAt + params.turnaroundMin + move <= trip.dep && trip.arr - state.blockStart <= params.maxBlockHours * 60;
}

function place(state: BusState, trip: Trip): void {
  if (state.trips.length === 0) state.blockStart = trip.dep;
  state.trips.push(trip);
  state.freeAt = trip.arr;
  state.terminal = trip.terminal;
  state.routeId = trip.routeId;
}

/** Undoes a bus's last trip, so a heavier departure can take its place. */
function unplaceLast(state: BusState): Trip {
  const last = state.trips.pop()!;
  const prev = state.trips[state.trips.length - 1];
  state.freeAt = prev?.arr ?? 0;
  state.terminal = prev?.terminal ?? 0;
  state.routeId = prev?.routeId ?? '';
  return last;
}

/** One pass of the greedy over trips in the given order; returns the buses' days and the uncovered. */
function assign(timetable: Timetable, trips: readonly Trip[], eligible: readonly SchedBus[], params: BusParams): { states: BusState[]; uncovered: UncoveredTrip[] } {
  const states: BusState[] = eligible.map((bus) => ({ bus, trips: [], freeAt: 0, terminal: 0, routeId: '', blockStart: 0 }));
  const uncovered: UncoveredTrip[] = [];
  for (const trip of trips) {
    let best: BusState | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const state of states) {
      if (!fits(state, trip, params)) continue;
      const s = score(state, trip, timetable, params.objective);
      if (s < bestScore) {
        best = state;
        bestScore = s;
      }
    }
    if (best) {
      place(best, trip);
      continue;
    }
    if (params.objective === 'coverage') {
      // A heavier departure takes the bus of the lightest overlapping last trip it can.
      const swap = states
        .filter((st) => st.trips.length > 0 && CAN_RUN[trip.serviceClass].includes(st.bus.serviceClass) && st.trips[st.trips.length - 1]!.weight < trip.weight)
        .filter((st) => {
          const prev = st.trips[st.trips.length - 2];
          const move = prev && prev.terminal !== trip.terminal ? REPOSITION_MIN : 0;
          const start = prev ? st.blockStart : trip.dep;
          return (!prev || prev.arr + params.turnaroundMin + move <= trip.dep) && trip.arr - start <= params.maxBlockHours * 60;
        })
        .sort((a, b) => a.trips[a.trips.length - 1]!.weight - b.trips[b.trips.length - 1]!.weight)[0];
      if (swap) {
        const dropped = unplaceLast(swap);
        uncovered.push({ trip: dropped, reason: 'displaced' });
        place(swap, trip);
        continue;
      }
    }
    const anyClass = eligible.some((b) => CAN_RUN[trip.serviceClass].includes(b.serviceClass));
    uncovered.push({ trip, reason: anyClass ? 'fleet_short' : 'no_class_bus' });
  }
  return { states, uncovered };
}

/** Day minutes mirrored, so a pass over the mirrored trips plans the day from its end. */
const MIRROR = 48 * 60;
const mirrored = (t: Trip): Trip => ({ ...t, dep: MIRROR - t.arr, arr: MIRROR - t.dep });

/** What an objective minimises once uncovered passengers are equal. */
function objectiveCost(plan: BusPlan, objective: Objective): number {
  const m = plan.metrics;
  if (objective === 'min_buses') return m.busesUsed * 1e6 + m.idleHours;
  if (objective === 'min_empty_km') return m.emptyKm * 1e3 + m.busesUsed;
  if (objective === 'coverage') return -m.passengersCovered;
  return m.cost.total;
}

export interface OptimiseTrace {
  /** The candidate solutions tried: planning from the start of the day and from its end. */
  readonly candidates: readonly { readonly label: string; readonly covered: number; readonly busesUsed: number; readonly cost: number; readonly chosen: boolean }[];
}

function planFrom(timetable: Timetable, trips: readonly Trip[], buses: readonly SchedBus[], eligible: readonly SchedBus[], states: readonly BusState[], uncovered: readonly UncoveredTrip[], params: BusParams, byId: ReadonlyMap<string, Trip> | null): BusPlan {
  const original = (t: Trip): Trip => (byId ? byId.get(t.id)! : t);
  const blocks = states.filter((s) => s.trips.length > 0).map((s) => blockOf(timetable, s.bus.registration, s.bus.serviceClass, s.trips.map(original), null));
  const unc = uncovered.map((u) => ({ ...u, trip: original(u.trip) })).sort((a, b) => a.trip.dep - b.trip.dep);
  const conflicts: Conflict[] = [];
  return {
    kind: 'optimised',
    objective: params.objective,
    trips,
    blocks,
    uncovered: unc,
    reserve: buses.filter((b) => b.restriction === 'reserve').map((b) => b.registration),
    conflicts,
    lowerBound: peakConcurrency(trips, params.turnaroundMin),
    metrics: measure(trips, blocks, unc, eligible.length, conflicts),
  };
}

/**
 * The optimised plan under the parameters' objective. The greedy is run twice, from the
 * start of the day and from its end (a bus's longest day binds differently each way),
 * and the plan carrying more passengers, then better on the objective, is kept.
 */
export function optimiseBuses(timetable: Timetable, trips: readonly Trip[], buses: readonly SchedBus[], params: BusParams, trace?: (t: OptimiseTrace) => void): BusPlan {
  const eligible = buses.filter((b) => b.restriction === null);
  const forward = assign(timetable, trips, eligible, params);
  const forwardPlan = planFrom(timetable, trips, buses, eligible, forward.states, forward.uncovered, params, null);
  const byId = new Map(trips.map((t) => [t.id, t]));
  const reverseTrips = trips.map(mirrored).sort((a, b) => a.dep - b.dep || b.weight - a.weight || a.id.localeCompare(b.id));
  const reverse = assign(timetable, reverseTrips, eligible, params);
  const reversePlan = planFrom(timetable, trips, buses, eligible, reverse.states, reverse.uncovered, params, byId);
  const lost = (p: BusPlan): number => p.metrics.passengersTotal - p.metrics.passengersCovered;
  const pickReverse = lost(reversePlan) < lost(forwardPlan) || (lost(reversePlan) === lost(forwardPlan) && objectiveCost(reversePlan, params.objective) < objectiveCost(forwardPlan, params.objective));
  trace?.({
    candidates: [
      { label: 'Planned from the start of the day', covered: forwardPlan.metrics.covered, busesUsed: forwardPlan.metrics.busesUsed, cost: forwardPlan.metrics.cost.total, chosen: !pickReverse },
      { label: 'Planned from the end of the day', covered: reversePlan.metrics.covered, busesUsed: reversePlan.metrics.busesUsed, cost: reversePlan.metrics.cost.total, chosen: pickReverse },
    ],
  });
  return pickReverse ? reversePlan : forwardPlan;
}

/**
 * The conventional plan: each route gets its own buses, taken in roster order from buses
 * of a class that can run it as the route's departures need them, under the same
 * turnaround and longest day, before today's status was known. A bus that cannot run
 * today leaves its departures uncovered.
 */
export function baselineBuses(timetable: Timetable, trips: readonly Trip[], buses: readonly SchedBus[], params: BusParams): BusPlan {
  const roster = [...buses].sort((a, b) => a.registration.localeCompare(b.registration));
  const taken = new Set<string>();
  const byRoute = new Map<string, Trip[]>();
  for (const t of trips) byRoute.set(t.routeId, [...(byRoute.get(t.routeId) ?? []), t]);
  const states: BusState[] = [];
  const uncovered: UncoveredTrip[] = [];
  for (const [routeId, routeTrips] of [...byRoute].sort((a, b) => a[0].localeCompare(b[0]))) {
    const cls = routeTrips[0]!.serviceClass;
    const own: BusState[] = [];
    for (const trip of routeTrips) {
      // The route's own buses first; the next bus of a class that can run it when none is free.
      let state = own.find((st) => st.freeAt + params.turnaroundMin <= trip.dep && trip.arr - st.blockStart <= params.maxBlockHours * 60);
      if (!state) {
        const bus = roster.find((b) => !taken.has(b.registration) && CAN_RUN[cls].includes(b.serviceClass));
        if (bus) {
          taken.add(bus.registration);
          state = { bus, trips: [], freeAt: 0, terminal: 0, routeId, blockStart: trip.dep };
          own.push(state);
        }
      }
      if (state) place(state, trip);
      else uncovered.push({ trip, reason: 'fleet_short' });
    }
    states.push(...own);
  }
  const conflicts: Conflict[] = [];
  const blocks = states
    .filter((s) => s.trips.length > 0)
    .map((s) => {
      const restriction = s.bus.restriction === 'reserve' ? null : s.bus.restriction;
      if (restriction) {
        conflicts.push({ kind: 'unavailable_bus', subject: s.bus.registration, text: `${s.bus.registration} holds ${s.trips.length} departures but is ${RESTRICTION_LABEL[restriction].toLowerCase()}.` });
        for (const trip of s.trips) uncovered.push({ trip, reason: 'bus_unavailable' });
      }
      return blockOf(timetable, s.bus.registration, s.bus.serviceClass, s.trips, restriction);
    });
  const eligible = buses.filter((b) => b.restriction === null || b.restriction === 'reserve').length;
  return {
    kind: 'baseline',
    objective: null,
    trips,
    blocks,
    uncovered: uncovered.sort((a, b) => a.trip.dep - b.trip.dep),
    reserve: [],
    conflicts,
    lowerBound: peakConcurrency(trips, params.turnaroundMin),
    metrics: measure(trips, blocks, uncovered, eligible, conflicts),
  };
}
