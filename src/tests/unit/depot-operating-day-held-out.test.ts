import { describe, expect, it } from 'vitest';
import type { DepotBusView } from '@/lib/depot/api';
import { dayFromPlan } from '@/lib/depot/sim/operatingDay';
import { planDay } from '@/lib/depot/sim/dayPlan';
import type { BusOpState, DepotSummary } from '@/lib/depot/types';

/*
 * A bus held out of the matching (not heard recently, or standing
 * away from the yard) did not run because it was held out, not for want of a
 * duty, so the day gives it its own reason. Off the road and dark stay
 * `unavailable`; an eligible bus left over is `no_duty`.
 */

const DEPOT = { id: 'd1', name: 'Depot 1', kind: 'depot', fleet: 5 } as unknown as DepotSummary;

function bus(reg: string, state: BusOpState, over: Partial<DepotBusView> = {}): DepotBusView {
  return {
    registrationNumber: reg,
    state,
    location: 'in_yard',
    routeName: 'A_ORD_1',
    gpsAgeMin: 1,
    notHeardMin: null,
    ...over,
  } as unknown as DepotBusView;
}

describe('why a bus did not run in the day', () => {
  it('says held_out for a held-out bus, unavailable when off the road or dark, no_duty when spare', () => {
    const buses = [
      bus('A', 'standing'),
      bus('B', 'standing'),
      bus('C', 'standing', { gpsAgeMin: 300, notHeardMin: 300 }),
      bus('D', 'standing', { location: 'away' }),
      bus('E', 'dark'),
    ];
    const planned = planDay({
      depot: DEPOT,
      buses,
      peakRequirement: 1,
      operatingDate: '2026-10-06',
      yardEstablished: true,
      now: { kind: 'feed_time', feedMinute: 600 },
    });
    const day = dayFromPlan('d1', '2026-10-06', planned, new Map());
    const reasons = new Map(day.notRun.map((b) => [b.registrationNumber, b.reason]));
    expect(day.runs).toHaveLength(1);
    expect(reasons.get('C')).toBe('held_out');
    expect(reasons.get('D')).toBe('held_out');
    expect(reasons.get('E')).toBe('unavailable');
    const spare = ['A', 'B'].filter((r) => reasons.has(r));
    expect(spare).toHaveLength(1);
    expect(reasons.get(spare[0] ?? '')).toBe('no_duty');
  });
});
