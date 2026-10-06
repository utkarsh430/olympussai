import { describe, expect, it } from 'vitest';
import type { DayRoute, OperatingDay } from '@/lib/depot/sim/operatingDayTypes';
import { FARE_PER_KM, LEGS_PER_TRIP, MAX_SEATS_PER_BUS } from '@/lib/depot/sim/revenueConfig';
import { modelRidershipDay } from '@/lib/depot/sim/ridership';

/**
 * Revenue and seat capacity rest on the same seats: the seats the buses that
 * ran actually offered, so the revenue per occupied seat-kilometre is the
 * class fare exactly, whether or not the seats divide evenly into trips.
 */

function route(trips: number, seatsOffered: number): DayRoute {
  return {
    routeName: 'AGRA_EXP_1',
    serviceClass: 'express',
    lengthKm: 100,
    lengthProvenance: 'modelled',
    roundTripTenths: 2000,
    duties: trips,
    trips,
    serviceKm: trips * 200,
    seatsOffered,
  } as DayRoute;
}

function dayWith(r: DayRoute): OperatingDay {
  return { operatingDate: '2026-10-06', routes: [r] } as unknown as OperatingDay;
}

/** Revenue divided by occupied seat-kilometres: the fare the model charged. */
function farePerOccupiedSeatKm(trips: number, seatsOffered: number): number {
  const [day] = modelRidershipDay(dayWith(route(trips, seatsOffered)));
  if (day === undefined) throw new Error('expected a route');
  const occupiedSeatKm = day.seatCapacity * day.loadFactor * day.lengthKm * LEGS_PER_TRIP;
  return day.revenue / occupiedSeatKm;
}

describe('revenue rests on the seats offered', () => {
  it('charges the class fare per occupied seat-km when the seats do not divide evenly into trips', () => {
    // Three trips by buses of 40, 44 and 49 seats: 133 seats, 44.33 a trip.
    expect(farePerOccupiedSeatKm(3, 133)).toBeCloseTo(FARE_PER_KM.express, 4);
  });

  it('caps a corrupt seat count per bus in both revenue and capacity', () => {
    const [day] = modelRidershipDay(dayWith(route(2, 2 * MAX_SEATS_PER_BUS + 90)));
    expect(day?.seatCapacity).toBe(2 * MAX_SEATS_PER_BUS);
    expect(day?.seatsPerTrip).toBe(MAX_SEATS_PER_BUS);
    expect(farePerOccupiedSeatKm(2, 2 * MAX_SEATS_PER_BUS + 90)).toBeCloseTo(FARE_PER_KM.express, 4);
  });

  it('offers no seats and earns nothing on a route no bus ran', () => {
    const [day] = modelRidershipDay(dayWith(route(0, 0)));
    expect(day?.seatCapacity).toBe(0);
    expect(day?.revenue).toBe(0);
    expect(day?.boardings).toBe(0);
  });
});
