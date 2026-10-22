import { describe, expect, it } from 'vitest';
import type { DepotBusView } from '@/lib/depot/api';
import type { CrewSlot } from '@/lib/depot/crew/types';
import { planSchedule } from '@/lib/depot/schedule/planSchedule';
import { minimalPieceCount } from '@/lib/depot/schedule/pieces';
import type { ScheduleInput } from '@/lib/depot/schedule/types';
import { needInputsFor } from '@/lib/depot/service/need';
import { planDay } from '@/lib/depot/sim/dayPlan';
import { modelBus } from '@/lib/depot/sim/fleetMaster';
import type { DepotSummary } from '@/lib/depot/types';

const DATE = '2026-10-12';
const depot = { id: '7', name: 'Depot', kind: 'depot' } as unknown as DepotSummary;

function bus(reg: string): DepotBusView {
  return { registrationNumber: reg, state: 'standing', location: 'in_yard', gpsAgeMin: 1, notHeardMin: null, routeName: null } as unknown as DepotBusView;
}

function slots(role: 'driver' | 'conductor', count: number): CrewSlot[] {
  return Array.from({ length: count }, (_, i) => ({ id: `${role[0]?.toUpperCase()}-${String(i + 1).padStart(3, '0')}`, role, availability: 'available', hoursThisWeek: 10 }));
}

/** Boardings that need two buses over the morning and one at midday. */
const BOARDINGS = [0, 0, 0, 0, 0, 65, 65, 65, 65, 65, 30, 30, 30, 30, 0, 0, 65, 65, 65, 0, 0, 0, 0, 0];

function route(name: string, operators: number): ScheduleInput['routes'][number] {
  const need = needInputsFor({ routeName: name, ledger: [], profileDurationMin: 120 });
  return {
    need: { routeName: name, boardingsByHour: BOARDINGS, need, neededByHour: BOARDINGS.map(() => 0), provenance: 'modelled' },
    timing: { journeyMinutes: 120, layoverMinutes: 15, cycleMinutes: 135, provenance: 'derived' },
    operatorBuses: [{ depotId: depot.id, buses: operators }],
    deadKm: { outKm: 4, inKm: 4, provenance: 'derived' },
  };
}

function inputOf(regs: readonly string[]): ScheduleInput {
  const buses = regs.map(bus);
  const baselinePlan = planDay({ depot, buses, peakRequirement: 4, operatingDate: DATE, yardEstablished: true, now: { kind: 'no_feed_clock' } });
  return {
    depot,
    operatingDate: DATE,
    now: { kind: 'no_feed_clock' },
    buses,
    fleet: new Map(buses.map((b) => [b.registrationNumber, modelBus(b.registrationNumber, null)])),
    yardEstablished: true,
    routes: [route('R1', 3), route('R2', 3)],
    crewPool: [...slots('driver', 12), ...slots('conductor', 12)],
    holds: [],
    baselinePlan,
  };
}

const REGS = ['UP1', 'UP2', 'UP3', 'UP4', 'UP5', 'UP6', 'UP7', 'UP8'];

describe('planSchedule', () => {
  it('covers every hour of need with the fewest blocks, deterministically, and partitions the fleet', () => {
    const input = inputOf(REGS);
    const plan = planSchedule(input);
    expect(planSchedule(input)).toEqual(plan);
    expect(planSchedule(inputOf([...REGS].reverse())).figures).toEqual(plan.figures);
    expect(plan.routes).toHaveLength(2);
    expect(plan.uncovered).toEqual([]);
    expect(plan.figures.uncoveredBusHours).toBe(0);
    expect(plan.blocks.length).toBeGreaterThanOrEqual(plan.blockLowerBound);
    expect(plan.blocks.length).toBeLessThanOrEqual(REGS.length);
    const withBus = plan.assignment.assignments.filter((a) => a.registrationNumber !== null).length;
    expect(withBus + plan.assignment.spareBuses.length + plan.assignment.excluded.length).toBe(REGS.length);
    expect(plan.assignment.blocksWithoutBus).toBe(0);
    for (const route of plan.routes) {
      const own = plan.pieces.filter((p) => p.routeName === route.routeName);
      expect(own.length).toBe(minimalPieceCount(route.hours.map((h) => h.needed)));
    }
    expect(plan.crew.shifts.every((s) => s.endMin - s.startMin <= 600 && s.shortfalls.length === 0)).toBe(true);
    expect(plan.crew.slotsUsed.driver).toBeLessThanOrEqual(plan.crew.chains);
    expect(plan.planMode).toBe(plan.baseline.mode);
    expect(plan.comparison.busesFreed).toBe(plan.baseline.figures.buses - plan.figures.buses);
  });

  it('reports uncovered need when buses are taken out of service, with the hold reason', () => {
    const plan = planSchedule(inputOf(REGS), { busesOutOfService: REGS.slice(1), crewUnavailable: { driver: 99 } });
    expect(plan.assignment.excluded.filter((e) => e.reason === 'out_of_service')).toHaveLength(REGS.length - 1);
    expect(plan.figures.buses).toBe(1);
    expect(plan.uncovered.length).toBeGreaterThan(0);
    expect(plan.uncovered.every((u) => u.reason === 'buses_held_out')).toBe(true);
    expect(plan.clamped.some((n) => n.startsWith('Drivers unavailable 99'))).toBe(true);
    expect(plan.params.crewUnavailable.driver).toBe(12);
    expect(plan.crew.shifts.every((s) => s.shortfalls.some((f) => f.role === 'driver'))).toBe(true);
  });
});
