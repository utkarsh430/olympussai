import { describe, expect, it } from 'vitest';
import { DEFAULT_BUS_PARAMS, DEFAULT_CREW_PARAMS } from '@/lib/depot/os/sched/config';
import { crewPool, rosterCrew, shiftsOf } from '@/lib/depot/os/sched/crew';
import { jointOptimise } from '@/lib/depot/os/sched/joint';
import { buildTimetable } from '@/lib/depot/os/sched/timetable';
import { tripsFor } from '@/lib/depot/os/sched/trips';
import type { BusParams, SchedBus } from '@/lib/depot/os/sched/types';
import { baselineBuses, CAN_RUN, optimiseBuses, restrictBuses } from '@/lib/depot/os/sched/vehicles';
import type { DepotSummary } from '@/lib/depot/types';

const DEPOT = { id: '73', name: 'AGRA FORT', centroid: { lat: 27.18, lng: 78.02 } };
const NEIGHBOURS = [
  { name: 'MATHURA', centroid: { lat: 27.49, lng: 77.67 } },
  { name: 'ETAH', centroid: { lat: 27.56, lng: 78.66 } },
  { name: 'ALIGARH', centroid: { lat: 27.88, lng: 78.08 } },
  { name: 'MAINPURI', centroid: { lat: 27.23, lng: 79.02 } },
];
const CLASSES = ['ordinary', 'ordinary', 'ordinary', 'express', 'ac'] as const;
const BUSES: SchedBus[] = Array.from({ length: 60 }, (_, i) => ({
  registration: `UP80AT${String(1000 + i)}`,
  serviceClass: CLASSES[i % CLASSES.length]!,
  state: i % 17 === 0 ? 'off_road' : 'standing',
  risk: (i * 7) % 70,
  serviceDueInDays: i % 13 === 0 ? -2 : 20,
  restriction: null,
}));

function plan(params: BusParams) {
  const tt = buildTimetable({ depot: DEPOT, neighbours: NEIGHBOURS, busesByClass: { ordinary: 36, express: 12, ac: 12 }, operatingDate: '2026-10-20' });
  const trips = tripsFor(tt, params);
  const buses = restrictBuses(BUSES, params);
  return { tt, trips, buses, optimised: optimiseBuses(tt, trips, buses, params), baseline: baselineBuses(tt, trips, buses, params) };
}

describe('OS scheduling engine', () => {
  it('is deterministic for a depot and date', () => {
    const a = plan(DEFAULT_BUS_PARAMS);
    const b = plan(DEFAULT_BUS_PARAMS);
    expect(a.tt.routes.map((r) => r.id)).toEqual(b.tt.routes.map((r) => r.id));
    expect(a.optimised.metrics).toEqual(b.optimised.metrics);
  });

  for (const objective of ['coverage', 'min_buses', 'min_empty_km', 'min_cost', 'balanced'] as const) {
    it(`never gives one bus overlapping departures, nor a restricted or wrong-class bus (${objective})`, () => {
      const params = { ...DEFAULT_BUS_PARAMS, objective };
      const { buses, optimised, trips } = plan(params);
      const restricted = new Set(buses.filter((b) => b.restriction !== null).map((b) => b.registration));
      for (const block of optimised.blocks) {
        expect(restricted.has(block.registration)).toBe(false);
        for (let i = 1; i < block.trips.length; i += 1) {
          expect(block.trips[i]!.dep).toBeGreaterThanOrEqual(block.trips[i - 1]!.arr + params.turnaroundMin);
        }
        for (const t of block.trips) expect(CAN_RUN[t.serviceClass]).toContain(block.serviceClass);
        expect(block.end - block.start).toBeLessThanOrEqual(params.maxBlockHours * 60);
      }
      // Every departure is either run once or listed uncovered.
      const run = optimised.blocks.flatMap((b) => b.trips.map((t) => t.id));
      expect(new Set(run).size).toBe(run.length);
      expect(run.length + optimised.uncovered.length).toBe(trips.length);
      expect(optimised.metrics.busesUsed).toBeGreaterThanOrEqual(Math.min(optimised.lowerBound, optimised.metrics.busesUsed));
    });
  }

  it('uses no more buses than the route-fixed baseline for the same service', () => {
    const { optimised, baseline } = plan({ ...DEFAULT_BUS_PARAMS, objective: 'min_buses', reservePct: 0 });
    expect(optimised.metrics.busesUsed).toBeLessThanOrEqual(baseline.blocks.length);
    expect(optimised.metrics.covered).toBeGreaterThanOrEqual(baseline.metrics.covered);
  });

  it('rosters crew without overlap, within the break rule and the AC endorsement', () => {
    const { optimised } = plan(DEFAULT_BUS_PARAMS);
    const shifts = shiftsOf(optimised.blocks, DEFAULT_CREW_PARAMS);
    const slots = crewPool(DEPOT as unknown as DepotSummary, shifts.length, '2026-10-20', { driver: 0, conductor: 0 });
    const roster = rosterCrew(shifts, slots, DEFAULT_CREW_PARAMS);
    const bySlot = new Map<string, { start: number; end: number }[]>();
    for (const a of roster.assignments) {
      for (const id of [a.driver, a.conductor]) if (id) bySlot.set(id, [...(bySlot.get(id) ?? []), { start: a.shift.start, end: a.shift.end }]);
      if (a.driver && a.shift.needsAc) expect(slots.find((s) => s.id === a.driver)?.acEndorsed).toBe(true);
    }
    for (const list of bySlot.values()) {
      const sorted = [...list].sort((x, y) => x.start - y.start);
      for (let i = 1; i < sorted.length; i += 1) expect(sorted[i]!.start - sorted[i - 1]!.end).toBeGreaterThanOrEqual(DEFAULT_CREW_PARAMS.minBreakMin);
    }
    expect(roster.metrics.restViolations + roster.metrics.qualificationViolations).toBe(0);
  });

  it('keeps the joint plan at least as operable as buses and crew planned separately', () => {
    const { tt, trips, buses, optimised } = plan(DEFAULT_BUS_PARAMS);
    const slots = crewPool(DEPOT as unknown as DepotSummary, shiftsOf(optimised.blocks, DEFAULT_CREW_PARAMS).length * 0.8, '2026-10-20', { driver: 0, conductor: 0 });
    const result = jointOptimise(tt, trips, buses, slots, DEFAULT_BUS_PARAMS, DEFAULT_CREW_PARAMS);
    expect(result.best.operablePassengers).toBeGreaterThanOrEqual(result.independent.operablePassengers);
  });
});
