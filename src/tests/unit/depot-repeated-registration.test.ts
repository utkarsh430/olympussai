import { describe, expect, it } from 'vitest';
import type { DepotBusView } from '@/lib/depot/api';
import { firstPerRegistration, planDay } from '@/lib/depot/sim/dayPlan';
import type { BusOpState, DepotSummary } from '@/lib/depot/types';

/*
 * Ruling S62, review m-a: a repeated registration keeps the row heard most
 * recently, so a stale repeat cannot make a bus heard a minute ago read "not
 * heard recently". Rows heard equally recently keep the existing rule.
 */

const DEPOT = { id: 'd1', name: 'Depot 1', kind: 'depot', fleet: 3 } as unknown as DepotSummary;

function bus(
  reg: string,
  state: BusOpState,
  gpsAgeMin: number | null,
  over: Partial<DepotBusView> = {},
): DepotBusView {
  const stale = gpsAgeMin !== null && gpsAgeMin > 30;
  return {
    registrationNumber: reg,
    state,
    location: state === 'standing' ? 'in_yard' : 'away',
    routeName: 'A_ORD_1',
    gpsAgeMin,
    notHeardMin: stale ? gpsAgeMin : null,
    ...over,
  } as unknown as DepotBusView;
}

/** The review's case: 'UP1' out on the road, heard 300 min ago; 'UP1 ' in the yard, 1 min ago. */
const STALE = bus('UP1', 'on_road', 300);
const FRESH = bus('UP1 ', 'standing', 1);
const OTHER = bus('UP2', 'standing', 1);

describe('a repeated registration keeps the row heard most recently (S62, m-a)', () => {
  it('keeps the fresh row whichever comes first', () => {
    for (const rows of [[STALE, FRESH], [FRESH, STALE]]) {
      const { buses, dropped } = firstPerRegistration(rows);
      expect(dropped).toBe(1);
      expect(buses).toEqual([{ ...FRESH, registrationNumber: 'UP1' }]);
    }
  });

  it('does not call the bus heard a minute ago "not heard recently", and matches it', () => {
    for (const rows of [[STALE, FRESH, OTHER], [OTHER, FRESH, STALE]]) {
      const planned = planDay({
        depot: DEPOT,
        buses: rows,
        peakRequirement: 2,
        operatingDate: '2026-10-06',
        yardEstablished: true,
        now: { kind: 'feed_time', feedMinute: 600 },
      });
      expect(planned.duties.length).toBe(2);
      expect(planned.plan.excluded).toEqual([]);
      expect(planned.plan.unassignedDuties).toBe(0);
      expect(planned.duplicateRowsDropped).toBe(1);
    }
  });

  it('treats a row with no age as heard least recently', () => {
    const unknown = bus('UP1', 'standing', null);
    const { buses } = firstPerRegistration([unknown, bus('UP1', 'on_road', 5)]);
    expect(buses[0]?.state).toBe('on_road');
  });

  it('breaks a tie on age with the existing rule: first in order, then a route, then the lower route', () => {
    const a = bus('UP1', 'standing', 2, { routeName: 'B_ORD_2' });
    const b = bus('UP1', 'standing', 2, { routeName: 'A_ORD_1' });
    const none = bus('UP1', 'standing', 2, { routeName: null });
    expect(firstPerRegistration([a, b]).buses[0]?.routeName).toBe('A_ORD_1');
    expect(firstPerRegistration([b, a]).buses[0]?.routeName).toBe('A_ORD_1');
    expect(firstPerRegistration([none, a]).buses[0]?.routeName).toBe('B_ORD_2');
    const noAgeA = bus('UP1', 'standing', null, { routeName: 'B_ORD_2' });
    const noAgeB = bus('UP1', 'standing', null, { routeName: 'A_ORD_1' });
    expect(firstPerRegistration([noAgeA, noAgeB]).buses[0]?.routeName).toBe('A_ORD_1');
    const onRoad = bus('UP1', 'on_road', 2);
    expect(firstPerRegistration([onRoad, a]).buses[0]?.state).toBe('on_road');
  });
});
