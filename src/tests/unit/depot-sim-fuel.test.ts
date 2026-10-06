import { describe, expect, it } from 'vitest';
import type { DepotBusView } from '@/lib/depot/api';
import { modelFuelDay } from '@/lib/depot/sim/fuel';
import {
  FUEL_CLASS_KM_PER_LITRE,
  FUEL_DAILY_NOISE,
  FUEL_EFFICIENCY_SPREAD,
} from '@/lib/depot/sim/fuelConfig';
import { modelOperatingDay } from '@/lib/depot/sim/operatingDay';
import type { OperatingDay } from '@/lib/depot/sim/operatingDayTypes';
import type { BusOpState, DepotSummary } from '@/lib/depot/types';

/*
 * The fuel model no longer draws a distance per bus
 * (a class figure times a state share); it reads each bus's duty from the
 * modelled operating day. The economy model (class figure, lasting per-vehicle
 * factor, daily noise) is unchanged and is still pinned here.
 */

const DAY_ONE = '2026-10-06';
const DAY_TWO = '2026-10-07';
const DEPOT = { id: '7', name: 'Kaushambi', kind: 'depot', fleet: 40 } as unknown as DepotSummary;

function bus(registrationNumber: string, state: BusOpState, routeName: string | null): DepotBusView {
  // Heard a minute ago, in the yard: a standing bus is then eligible for a duty.
  return {
    registrationNumber, state, routeName, location: 'in_yard', gpsAgeMin: 1, notHeardMin: null,
  } as unknown as DepotBusView;
}

const BUSES: readonly DepotBusView[] = Array.from({ length: 40 }, (_, i) =>
  bus(`UP32AB${1000 + i}`, i % 10 === 9 ? 'off_road' : 'on_road', i % 2 === 0 ? 'PUNE_EXP_X' : 'AKOLA_ORD_Y'),
);

function dayOf(operatingDate: string, buses: readonly DepotBusView[] = BUSES): OperatingDay {
  return modelOperatingDay({ depot: DEPOT, buses, peakRequirement: 30, realLengthKm: new Map(), operatingDate });
}

describe('modelFuelDay', () => {
  it('is deterministic and independent of input order', () => {
    const a = modelFuelDay(dayOf(DAY_ONE));
    expect(modelFuelDay(dayOf(DAY_ONE))).toEqual(a);
    expect(modelFuelDay(dayOf(DAY_ONE, [...BUSES].reverse()))).toEqual(a);
    expect(a.map((r) => r.registrationNumber)).toEqual([...a.map((r) => r.registrationNumber)].sort());
  });

  it('differs between dates', () => {
    expect(modelFuelDay(dayOf(DAY_ONE))).not.toEqual(modelFuelDay(dayOf(DAY_TWO)));
  });

  it('has a row for each bus that ran and none for a bus that did not', () => {
    const day = dayOf(DAY_ONE);
    const rows = modelFuelDay(day);
    // 36 buses are available and there are 30 duties: 30 ran, 10 did not (6 spare, 4 off the road).
    expect(rows).toHaveLength(30);
    expect(day.notRun).toHaveLength(10);
    const idle = new Set(day.notRun.map((b) => b.registrationNumber));
    expect(rows.some((r) => idle.has(r.registrationNumber))).toBe(false);
    expect(rows.every((r) => r.distanceKm > 0 && r.fuelLitres > 0)).toBe(true);
  });

  it('takes each distance and route from the bus’s duty, never from a draw of its own', () => {
    const day = dayOf(DAY_ONE);
    const byBus = new Map(day.runs.map((run) => [run.registrationNumber, run]));
    for (const row of modelFuelDay(day)) {
      const run = byBus.get(row.registrationNumber);
      expect([row.distanceKm, row.routeName, row.serviceClass]).toEqual([
        run?.distanceKm,
        run?.routeName,
        run?.busClass,
      ]);
    }
  });

  it('keeps each bus’s economy within its class figure, lasting factor and daily noise', () => {
    const spread = (1 + FUEL_EFFICIENCY_SPREAD) * (1 + FUEL_DAILY_NOISE);
    const floor = (1 - FUEL_EFFICIENCY_SPREAD) * (1 - FUEL_DAILY_NOISE);
    for (const row of modelFuelDay(dayOf(DAY_ONE))) {
      const base = FUEL_CLASS_KM_PER_LITRE[row.serviceClass];
      const kmPerLitre = row.distanceKm / row.fuelLitres;
      // Litres are rounded to a tenth, so allow that much on the ratio.
      expect(kmPerLitre).toBeGreaterThan(base * floor * 0.99);
      expect(kmPerLitre).toBeLessThan(base * spread * 1.01);
    }
  });
});
