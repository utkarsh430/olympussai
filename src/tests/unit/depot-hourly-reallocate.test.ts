import { describe, expect, it } from 'vitest';
import {
  MAX_INTRA_DAY_KM,
  planHourlyReallocation,
  type ReallocationDepot,
  type ReallocationRoute,
} from '@/lib/depot/optimise/hourlyReallocate';
import type { RouteProfile } from '@/lib/depot/routes/types';

/** Lucknow-ish positions: A and B about 11 km apart, F about 300 km away. */
const A = { lat: 26.85, lng: 80.95 };
const B = { lat: 26.85, lng: 81.06 };
const F = { lat: 29.5, lng: 80.95 };

const depot = (depotId: string, position: typeof A | null, standing: number): ReallocationDepot => ({
  depotId,
  depotName: `Depot ${depotId}`,
  position,
  standing,
});

function profileAt(at: typeof A): RouteProfile {
  const stop = (sequence: number, lng: number) => ({
    name: `S${sequence}`, sequence, lat: at.lat, lng, scheduled: null,
  });
  return {
    routeName: 'X', routeNameConfirmed: true, routeId: null, description: null, direction: null,
    origin: null, destination: null, stops: [stop(1, at.lng), stop(2, at.lng + 0.01)],
    unlocatedStops: 0, mislocatedStops: 0, scheduledDurationMin: 60, lengthKm: 1,
    sampledFrom: 'UP32A0001', operatingDate: '2026-10-06',
  };
}

const route = (
  routeName: string,
  depotId: string | null,
  gap: number,
  deployed = 6,
  profile: RouteProfile | null = null,
): ReallocationRoute => ({ routeName, depotId, gap, deployed, profile });

const plan = (depots: readonly ReallocationDepot[], routes: readonly ReallocationRoute[]) =>
  planHourlyReallocation({ band: 'morning_peak', depots, routes, detourFactor: 1.3 });

describe('the hourly reallocation', () => {
  it('moves a depot’s held and standing buses to its own short route at no cost', () => {
    const result = plan([depot('A', A, 1)], [route('SHORT', 'A', 3), route('OVER', 'A', -2)]);
    expect(result.moves).toEqual([
      expect.objectContaining({ fromDepotId: 'A', routeName: 'SHORT', buses: 3, withinDepot: true, deadKmPerBus: 0 }),
    ]);
    expect(result).toMatchObject({ busesWithin: 3, busesBetween: 0, deadKm: 0, uncovered: [] });
  });

  it('holds back one bus on an over route', () => {
    const result = plan([depot('A', A, 0)], [route('SHORT', 'A', 5), route('OVER', 'A', -4, 2)]);
    expect(result.busesWithin).toBe(1);
    expect(result.uncovered).toEqual([
      { routeName: 'SHORT', depotId: 'A', buses: 4, reason: 'insufficient_surplus' },
    ]);
  });

  it('draws on a near depot at its dead km, preferring a free move first', () => {
    const result = plan(
      [depot('A', A, 1), depot('B', B, 5)],
      [route('SHORT', 'A', 3, 6, profileAt(A))],
    );
    const between = result.moves.find((m) => !m.withinDepot);
    expect(between).toMatchObject({ fromDepotId: 'B', toDepotId: 'A', buses: 2 });
    expect(between?.deadKmPerBus).toBeGreaterThan(0);
    expect(between?.deadKmPerBus).toBeLessThanOrEqual(MAX_INTRA_DAY_KM);
    expect(result).toMatchObject({ busesWithin: 1, busesBetween: 2 });
    expect(result.deadKm).toBeCloseTo(2 * (between?.deadKmPerBus ?? 0), 5);
  });

  it('measures a route with no profile from its own depot, there and back', () => {
    const result = plan([depot('A', A, 0), depot('B', B, 5)], [route('SHORT', 'A', 2)]);
    expect(result.busesBetween).toBe(2);
    expect(result.moves[0]?.deadKmPerBus).toBeGreaterThan(20);
  });

  it('says why a deficit is left: out of range, no position', () => {
    const far = plan([depot('A', A, 0), depot('F', F, 9)], [route('SHORT', 'A', 2)]);
    expect(far.uncovered).toEqual([{ routeName: 'SHORT', depotId: 'A', buses: 2, reason: 'no_surplus_in_range' }]);
    const lost = plan([depot('B', B, 9)], [route('LOOSE', null, 2), route('BLIND', 'Z', 1)]);
    expect(lost.uncovered.map((u) => [u.routeName, u.reason])).toEqual([
      ['BLIND', 'no_position'],
      ['LOOSE', 'no_position'],
    ]);
  });

  it('gives the same plan whatever the input order', () => {
    const depots = [depot('A', A, 1), depot('B', B, 3)];
    const routes = [route('R1', 'A', 2), route('R2', 'B', -2), route('R3', 'A', 2)];
    expect(plan([...depots].reverse(), [...routes].reverse())).toEqual(plan(depots, routes));
  });
});
