import { describe, expect, it } from 'vitest';
import {
  maintenanceWindows,
  reserveByHour,
  routeProposalsInBand,
} from '@/lib/depot/service/networkProposals';
import { corridorFindings, shiftDepartures } from '@/lib/depot/service/networkFindings';
import { isProposalId } from '@/lib/depot/service/bands';
import type { RouteProfile } from '@/lib/depot/routes/types';
import { FIXTURE_PROPOSALS } from './depot-service-fixtures';
import { craftedDay } from './depot-service-network-fixtures';

const DATE = '2026-10-06';

/** Needed buses with two peaks (06–10 at 10, 16–20 at 8) and a quiet midday of 3. */
const NEEDED = Array.from({ length: 24 }, (_, h) =>
  h >= 6 && h <= 9 ? 10 : h >= 16 && h <= 19 ? 8 : h >= 4 && h <= 23 ? 3 : 0,
);

describe('reserve by hour', () => {
  it('holds the spare ratio of the band’s need at each depot, rounded up', () => {
    const days = [
      craftedDay({ routeName: 'R1', depotId: 'A', deployed: 8, needed: NEEDED }),
      craftedDay({ routeName: 'R2', depotId: 'A', deployed: 8, needed: NEEDED }),
    ];
    const [reserve] = reserveByHour(days, 'morning_peak', DATE);
    expect(reserve).toMatchObject({
      kind: 'reserve_by_hour', depotId: 'A', routeName: null, count: 2, group: 'network',
      change: 0, needed: 20, band: { fromHour: 6, toHour: 9 },
    });
    expect(reserve?.reason).toContain('20');
    expect(isProposalId(reserve?.id)).toBe(true);
  });

  it('proposes nothing for a depot with no need in the band', () => {
    const quiet = craftedDay({ routeName: 'R1', depotId: 'A', deployed: 0, needed: 0 });
    expect(reserveByHour([quiet], 'midday', DATE)).toEqual([]);
  });
});

describe('maintenance windows', () => {
  const days = [craftedDay({ routeName: 'R1', depotId: 'A', deployed: 8, needed: NEEDED })];

  it('opens a window in a quiet band with idle buses', () => {
    const [window] = maintenanceWindows(days, 'midday', DATE, new Map([['A', 2]]));
    expect(window).toMatchObject({ kind: 'maintenance_window', depotId: 'A', count: 7, group: 'network' });
    expect(window?.reason).toMatch(/maintenance/);
  });

  it('never opens one in a peak, nor with too few idle buses', () => {
    expect(maintenanceWindows(days, 'morning_peak', DATE, new Map([['A', 9]]))).toEqual([]);
    const busy = [craftedDay({ routeName: 'R1', depotId: 'A', deployed: 3, needed: NEEDED })];
    expect(maintenanceWindows(busy, 'midday', DATE, new Map([['A', 1]]))).toEqual([]);
  });
});

describe('shift departures', () => {
  it('moves trips from an over hour to the adjacent short hour on the same route', () => {
    const deployed = Array.from({ length: 24 }, (_, h) => (h === 8 ? 4 : h === 9 ? 12 : 6));
    const needed = Array.from({ length: 24 }, (_, h) => (h === 8 ? 10 : h === 9 ? 5 : 6));
    const day = craftedDay({ routeName: 'R1', depotId: 'A', deployed, needed, measured: [8, 9] });
    const [shift] = shiftDepartures([day], 'morning_peak', DATE);
    expect(shift).toMatchObject({
      kind: 'shift_departures', routeName: 'R1', band: { fromHour: 8, toHour: 9 }, tier: 'B', group: 'network',
    });
    expect(shift?.count).toBeGreaterThanOrEqual(1);
    expect(shift?.reason).toContain('09:00');
  });

  it('finds nothing where no over hour neighbours a short one', () => {
    const day = craftedDay({ routeName: 'R1', depotId: 'A', deployed: 4, needed: 8 });
    expect(shiftDepartures([day], 'morning_peak', DATE)).toEqual([]);
  });
});

function profile(first: string, last: string): RouteProfile {
  const stop = (name: string, sequence: number, lng: number) => ({
    name, sequence, lat: 26.85, lng, scheduled: null,
  });
  return {
    routeName: 'X', routeNameConfirmed: true, routeId: null, description: null, direction: null,
    origin: null, destination: null, stops: [stop(first, 1, 80.9), stop(last, 2, 81.2)],
    unlocatedStops: 0, mislocatedStops: 0, scheduledDurationMin: 60, lengthKm: 30,
    sampledFrom: 'UP32A0001', operatingDate: DATE,
  };
}

describe('corridors', () => {
  const profiles = new Map([
    ['UP_1', profile('Charbagh', 'Kanpur')],
    ['DOWN_1', profile('Kanpur', 'Charbagh')],
    ['OTHER', profile('Agra', 'Mathura')],
  ]);

  it('groups routes by terminal pair either way and finds an under-served corridor', () => {
    const days = [
      craftedDay({ routeName: 'UP_1', depotId: 'A', deployed: 3, needed: 6 }),
      craftedDay({ routeName: 'DOWN_1', depotId: 'B', deployed: 4, needed: 6 }),
      craftedDay({ routeName: 'OTHER', depotId: 'A', deployed: 1, needed: 9 }),
    ];
    const found = corridorFindings(days, 'morning_peak', DATE, profiles);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: 'corridor_under_served', routes: ['DOWN_1', 'UP_1'], count: 5, group: 'findings', routeName: null,
    });
    expect(found[0]?.reason).toContain('Charbagh');
  });

  it('finds an over-served corridor', () => {
    const days = [
      craftedDay({ routeName: 'UP_1', depotId: 'A', deployed: 8, needed: 5 }),
      craftedDay({ routeName: 'DOWN_1', depotId: 'B', deployed: 7, needed: 5 }),
    ];
    const [over] = corridorFindings(days, 'midday', DATE, profiles);
    expect(over).toMatchObject({ kind: 'corridor_over_served', count: 5 });
  });

  it('says nothing of a route with no loaded profile', () => {
    const days = [craftedDay({ routeName: 'NONE', depotId: 'A', deployed: 1, needed: 9 })];
    expect(corridorFindings(days, 'midday', DATE, profiles)).toEqual([]);
  });
});

describe('a route’s own proposals on the network', () => {
  it('keeps those overlapping the band, grouped and carrying the depot', () => {
    const day = { ...craftedDay({ routeName: 'KANPUR-LUCKNOW', depotId: 'A', deployed: 1, needed: 1 }) };
    const withProposals = { ...day, day: { ...day.day, proposals: FIXTURE_PROPOSALS } };
    const all = routeProposalsInBand([withProposals], 'morning_peak');
    expect(all.length).toBeGreaterThan(0);
    for (const p of all) {
      expect(p.band.toHour).toBeGreaterThanOrEqual(6);
      expect(p.band.fromHour).toBeLessThanOrEqual(9);
      expect(p.depotId).toBe('A');
      expect(p.routes).toEqual([p.routeName]);
      expect(p.group).toBe(p.change === 0 ? 'findings' : 'changes');
    }
    expect(routeProposalsInBand([withProposals], 'early')).toEqual([]);
  });
});
