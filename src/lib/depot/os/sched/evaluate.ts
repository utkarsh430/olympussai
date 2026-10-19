import { FUEL_CLASS_KM_PER_LITRE } from '../../sim/fuelConfig';
import type { ServiceClass } from '../../sim/types';
import { BUS_DAY_FIXED_COST, CREW_COST_PER_HOUR, CREW_RELEASE_GAP_MIN, DIESEL_PRICE, REPOSITION_KM } from './config';
import type { BusBlock, BusRestriction, Conflict, CostBreakdown, PlanMetrics, Timetable, Trip, UncoveredTrip } from './types';

/*
 * How every bus plan is measured, whichever method made it: the same block figures, the
 * same empty kilometres and the same cost estimate, so a comparison is like for like.
 */

/** Kilometres run empty between two terminals. */
export function repositionKm(timetable: Timetable, from: number, to: number): number {
  if (from === to) return 0;
  return Math.abs((timetable.terminalKm[from] ?? 0) - (timetable.terminalKm[to] ?? 0)) + REPOSITION_KM;
}

/** One bus's day from its trips (in departure order). */
export function blockOf(timetable: Timetable, registration: string, serviceClass: ServiceClass, trips: readonly Trip[], unavailable: BusRestriction | null): BusBlock {
  const sorted = [...trips].sort((a, b) => a.dep - b.dep);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  let deadKm = (timetable.terminalKm[first.terminal] ?? 0) + (timetable.terminalKm[last.terminal] ?? 0);
  for (let i = 1; i < sorted.length; i += 1) deadKm += repositionKm(timetable, sorted[i - 1]!.terminal, sorted[i]!.terminal);
  const serviceMin = sorted.reduce((s, t) => s + (t.arr - t.dep), 0);
  return {
    registration,
    serviceClass,
    trips: sorted,
    start: first.dep,
    end: last.arr,
    serviceMin,
    idleMin: last.arr - first.dep - serviceMin,
    deadKm,
    serviceKm: sorted.reduce((s, t) => s + t.km, 0),
    passengers: sorted.reduce((s, t) => s + t.passengers, 0),
    unavailable,
  };
}

/** Minutes a block's crew is paid: its span less the gaps long enough to release them. */
export function paidMinutes(block: BusBlock): number {
  let released = 0;
  for (let i = 1; i < block.trips.length; i += 1) {
    const gap = block.trips[i]!.dep - block.trips[i - 1]!.arr;
    if (gap >= CREW_RELEASE_GAP_MIN) released += gap;
  }
  return block.end - block.start - released;
}

export function costOf(blocks: readonly BusBlock[]): CostBreakdown {
  let fuel = 0;
  let crew = 0;
  for (const b of blocks) {
    fuel += ((b.serviceKm + b.deadKm) / FUEL_CLASS_KM_PER_LITRE[b.serviceClass]) * DIESEL_PRICE;
    crew += (paidMinutes(b) / 60) * CREW_COST_PER_HOUR;
  }
  const fixed = blocks.length * BUS_DAY_FIXED_COST;
  return { fuel: Math.round(fuel), crew: Math.round(crew), fixed, total: Math.round(fuel + crew + fixed) };
}

/** The figures of a plan; blocks of buses that cannot run carry no service. */
export function measure(trips: readonly Trip[], blocks: readonly BusBlock[], uncovered: readonly UncoveredTrip[], eligibleBuses: number, conflicts: readonly Conflict[]): PlanMetrics {
  const runnable = blocks.filter((b) => b.unavailable === null);
  const coveredTrips = runnable.flatMap((b) => b.trips);
  const busMin = runnable.reduce((s, b) => s + (b.end - b.start), 0);
  const serviceMin = runnable.reduce((s, b) => s + b.serviceMin, 0);
  return {
    departures: trips.length,
    covered: coveredTrips.length,
    uncovered: uncovered.length,
    passengersTotal: trips.reduce((s, t) => s + t.passengers, 0),
    passengersCovered: coveredTrips.reduce((s, t) => s + t.passengers, 0),
    busesUsed: runnable.length,
    eligibleBuses,
    busHours: busMin / 60,
    serviceHours: serviceMin / 60,
    idleHours: (busMin - serviceMin) / 60,
    emptyKm: Math.round(runnable.reduce((s, b) => s + b.deadKm, 0)),
    serviceKm: Math.round(runnable.reduce((s, b) => s + b.serviceKm, 0)),
    utilisation: busMin > 0 ? serviceMin / busMin : 0,
    cost: costOf(runnable),
    conflicts: conflicts.length,
  };
}
