// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { proposalImpact } from '@/lib/depot/service/impact';
import type { NeedInputs, RouteHourFigures } from '@/lib/depot/service/types';
import { COST_PER_BUS_KM } from '@/lib/depot/sim/hourlyDemandConfig';
import { AVG_TRIP_LENGTH_SHARE, FARE_PER_KM } from '@/lib/depot/sim/revenueConfig';

// 52 seats x 0.75 / 0.6 = 65 boardings a trip; 105 + 15 min: half a trip a bus-hour.
const need: NeedInputs = {
  routeName: 'R1',
  serviceClass: 'ordinary',
  seatsPerBus: 52,
  journeyMinutes: 105,
  journeyMinutesProvenance: 'derived',
  layoverMinutes: 15,
  targetLoad: 0.75,
  busiestStretchShare: 0.6,
};

function hour(h: number, deployed: number, demand: number): RouteHourFigures {
  return {
    hour: h,
    deployed,
    deployedBasis: 'observed',
    slotsObserved: 12,
    scheduled: null,
    scheduledTripsStarting: null,
    demand,
    demandBand: { low: 0, high: 0 },
    needed: 0,
    gap: 0,
    delayMedianMin: null,
    lateShare: null,
    delayCoverage: { n: 0, of: 0 },
  };
}

// Each bus carries 32.5 boardings an hour. Hour 7: 10 buses carry 325 of 520.
const hours = [hour(7, 10, 520), hour(8, 10, 600), hour(9, 10, 200)];
const base = { band: { fromHour: 7, toHour: 8 }, hours, need, lengthKm: 40 };

describe('proposalImpact', () => {
  it('counts the passengers the change lets the route carry, as a quarter-wide range', () => {
    // Adding 4 buses carries 130 more in each of hours 7 and 8 (both still short): 260.
    const impact = proposalImpact({ ...base, change: 4 });
    expect(impact.passengersPerDay).toEqual({ low: 195, high: 325 });
    expect(impact.provenance).toBe('modelled');
  });

  it('never counts more passengers than were left behind', () => {
    // 10 more buses carry all of both hours: 195 left behind at 07, 275 at 08.
    const impact = proposalImpact({ ...base, change: 10 });
    expect(impact.passengersPerDay.high).toBe(Math.round((195 + 275) * 1.25));
  });

  it('prices passengers at the class fare over the average ride', () => {
    const impact = proposalImpact({ ...base, change: 4 });
    const perBoarding = AVG_TRIP_LENGTH_SHARE * 40 * FARE_PER_KM.ordinary;
    expect(impact.revenuePerDay.low).toBe(Math.round(260 * perBoarding * 0.75));
    expect(impact.revenuePerDay.high).toBe(Math.round(260 * perBoarding * 1.25));
  });

  it('runs the added buses over the band and costs them per km', () => {
    // 4 buses x 2 hours x half a trip an hour x 40 km = 160 km.
    const impact = proposalImpact({ ...base, change: 4 });
    expect(impact.busKmPerDay).toEqual({ low: 120, high: 200 });
    expect(impact.costPerDay).toEqual({
      low: Math.round(160 * COST_PER_BUS_KM * 0.75),
      high: Math.round(160 * COST_PER_BUS_KM * 1.25),
    });
  });

  it('adds dead km once per added bus when given, and works without it', () => {
    const withDead = proposalImpact({ ...base, change: 4, deadKmPerTrip: 10 });
    expect(withDead.busKmPerDay).toEqual({ low: 150, high: 250 });
    const without = proposalImpact({ ...base, change: 4, deadKmPerTrip: null });
    expect(without.busKmPerDay).toEqual({ low: 120, high: 200 });
  });

  it('reads a hold as km and cost saved, low below high', () => {
    // Holding 2 in a band that carries everything loses no passenger.
    const quiet = [hour(7, 10, 100), hour(8, 10, 100)];
    const impact = proposalImpact({ ...base, hours: quiet, change: -2 });
    expect(impact.passengersPerDay).toEqual({ low: 0, high: 0 });
    expect(impact.busKmPerDay).toEqual({ low: -100, high: -60 });
    expect(impact.costPerDay.low).toBeLessThan(impact.costPerDay.high);
  });

  it('claims no passengers for a hold, only the bus-km and cost it saves, dead km included', () => {
    // A hold releases buses beyond the need; the hour's carrying never decides it.
    const impact = proposalImpact({ ...base, change: -2, deadKmPerTrip: 10 });
    expect(impact.passengersPerDay).toEqual({ low: 0, high: 0 });
    expect(impact.revenuePerDay).toEqual({ low: 0, high: 0 });
    // 2 buses x 2 hours x half a trip an hour x 40 km = 80 km, plus 2 x 10 dead km = 100 km.
    expect(impact.busKmPerDay).toEqual({ low: -125, high: -75 });
    expect(impact.costPerDay).toEqual({
      low: -Math.round(100 * COST_PER_BUS_KM * 1.25),
      high: -Math.round(100 * COST_PER_BUS_KM * 0.75),
    });
  });

  it('answers zero everywhere for no change', () => {
    const impact = proposalImpact({ ...base, change: 0, deadKmPerTrip: 12 });
    const zero = { low: 0, high: 0 };
    expect(impact).toMatchObject({
      passengersPerDay: zero,
      revenuePerDay: zero,
      busKmPerDay: zero,
      costPerDay: zero,
    });
  });
});
