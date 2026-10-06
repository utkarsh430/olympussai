import { describe, expect, it } from 'vitest';
import { modelRouteLength } from '@/lib/depot/sim/operatingDay';
import { MIN_REAL_LENGTH_KM } from '@/lib/depot/sim/operatingDayConfig';
import type { DayRoute, OperatingDay } from '@/lib/depot/sim/operatingDayTypes';
import { modelRidershipDay } from '@/lib/depot/sim/ridership';

/* Arithmetic edges of the modelled day. */

describe('route lengths and seat capacity at the edges', () => {
  it('treats a real length under the floor as not known: the modelled length applies', () => {
    expect(MIN_REAL_LENGTH_KM).toBe(2);
    expect(modelRouteLength('LKO_ORD_1', 'ordinary', 0.1).lengthProvenance).toBe('modelled');
    expect(modelRouteLength('LKO_ORD_1', 'ordinary', 1.9).lengthKm).toBeGreaterThanOrEqual(70);
    expect(modelRouteLength('LKO_ORD_1', 'ordinary', 2)).toEqual({
      lengthKm: 2,
      lengthProvenance: 'derived',
    });
  });

  it('states the seats actually offered as the capacity, not a rounded average', () => {
    const route: DayRoute = {
      routeName: 'AGRA_EXP_1', serviceClass: 'express', lengthKm: 100, lengthProvenance: 'modelled',
      roundTripTenths: 2000, duties: 2, trips: 2, serviceKm: 400, seatsOffered: 95,
    };
    const day = { routes: [route], operatingDate: '2026-10-06' } as unknown as OperatingDay;
    expect(modelRidershipDay(day)[0]?.seatCapacity).toBe(95);
  });
});
