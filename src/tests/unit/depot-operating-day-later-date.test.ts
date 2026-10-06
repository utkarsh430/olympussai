import { describe, expect, it } from 'vitest';
import type { DepotBusView } from '@/lib/depot/api';
import { planDay } from '@/lib/depot/sim/dayPlan';
import type { BusOpState, DepotSummary } from '@/lib/depot/types';

/*
 * Ruling S55, review N1: the night parking order plans TOMORROW's first
 * departures for the buses standing in the yard tonight. A plan for a later
 * date must not rank buses by how they stand now (no on-the-road tier, no
 * time fit): the buses in the yard are the ones that will leave it. The plan
 * for the feed's own date is untouched.
 */

const DEPOT = { id: 'd1', name: 'Depot 1', kind: 'depot', fleet: 90 } as unknown as DepotSummary;
const ROUTES = ['A_ORD_1', 'B_ORD_2', 'C_ORD_3'];

function bus(reg: string, state: BusOpState, routeName: string | null): DepotBusView {
  return {
    registrationNumber: reg,
    state,
    location: state === 'standing' ? 'in_yard' : 'away',
    routeName,
    gpsAgeMin: 1,
    notHeardMin: null,
  } as unknown as DepotBusView;
}

/** The reviewer's case: 85 buses in service, 5 standing in the yard, peak 81. */
const BUSES: readonly DepotBusView[] = [
  ...Array.from({ length: 85 }, (_, i) => bus(`S${String(i).padStart(2, '0')}`, 'in_service', ROUTES[i % 3] ?? null)),
  ...Array.from({ length: 5 }, (_, i) => bus(`Y${i}`, 'standing', ROUTES[i % 3] ?? null)),
];
const YARD = BUSES.filter((b) => b.state === 'standing').map((b) => b.registrationNumber);

const base = {
  depot: DEPOT,
  buses: BUSES,
  peakRequirement: 81,
  yardEstablished: true,
} as const;

const withDuty = (plan: ReturnType<typeof planDay>): Set<string | null> =>
  new Set(plan.plan.assignments.map((a) => a.registrationNumber));

describe('a plan for a later date (ruling S55, N1)', () => {
  it('gives every yard bus a first duty when the duties allow, however many buses are out now', () => {
    const tomorrow = planDay({ ...base, operatingDate: '2026-10-07', now: { kind: 'later_day' } });
    expect(tomorrow.duties.length).toBe(81);
    const taken = withDuty(tomorrow);
    for (const reg of YARD) expect(taken.has(reg)).toBe(true);
  });

  it('records the yard buses as standing in the yard, never as on the road now', () => {
    const tomorrow = planDay({ ...base, operatingDate: '2026-10-07', now: { kind: 'later_day' } });
    const standing = new Set(tomorrow.plan.assignments.map((a) => a.busStanding));
    expect(standing.has('on_road')).toBe(false);
  });

  it('leaves the plan for the feed’s own date unchanged: in-service buses run first', () => {
    const today = planDay({
      ...base,
      operatingDate: '2026-10-06',
      now: { kind: 'feed_time', feedMinute: 600 },
    });
    const taken = withDuty(today);
    expect(today.plan.unassignedDuties).toBe(0);
    for (const reg of YARD) expect(taken.has(reg)).toBe(false);
  });
});
