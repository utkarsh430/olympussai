import { describe, expect, it } from 'vitest';
import { modelFuelDay } from '@/lib/depot/sim/fuel';
import { modelBus } from '@/lib/depot/sim/fleetMaster';
import {
  FUEL_CLASS_KM_PER_LITRE,
  FUEL_DAILY_NOISE,
  FUEL_EFFICIENCY_SPREAD,
} from '@/lib/depot/sim/fuelConfig';
import type { DepotBusView } from '@/lib/depot/api';
import type { BusOpState } from '@/lib/depot/types';
import type { ModelledBus } from '@/lib/depot/sim/types';

const DAY_ONE = '2026-10-06';
const DAY_TWO = '2026-10-07';
const SLACK = 0.01;

function bus(registrationNumber: string, state: BusOpState, routeName: string | null): DepotBusView {
  return { registrationNumber, state, routeName } as unknown as DepotBusView;
}

function fleetOf(buses: readonly DepotBusView[]): ReadonlyMap<string, ModelledBus> {
  return new Map(
    buses.map((b) => [b.registrationNumber, modelBus(b.registrationNumber, b.routeName)]),
  );
}

const BUSES: readonly DepotBusView[] = Array.from({ length: 40 }, (_, i) =>
  bus(`UP32AB${1000 + i}`, 'on_road', i % 2 === 0 ? 'PUNE_EXP_X' : 'AKOLA_ORD_Y'),
);

describe('modelFuelDay', () => {
  it('is deterministic and independent of input order', () => {
    const fleet = fleetOf(BUSES);
    const a = modelFuelDay(BUSES, fleet, DAY_ONE);
    expect(modelFuelDay(BUSES, fleet, DAY_ONE)).toEqual(a);
    expect(modelFuelDay([...BUSES].reverse(), fleet, DAY_ONE)).toEqual(a);
  });

  it('differs between dates', () => {
    const fleet = fleetOf(BUSES);
    expect(modelFuelDay(BUSES, fleet, DAY_ONE)).not.toEqual(modelFuelDay(BUSES, fleet, DAY_TWO));
  });

  it('gives off-road and dark buses zero distance and zero fuel', () => {
    const buses = [
      bus('UP1', 'off_road', null),
      bus('UP2', 'dark', null),
      bus('UP3', 'on_road', null),
    ];
    const rows = modelFuelDay(buses, fleetOf(buses), DAY_ONE);
    const byReg = new Map(rows.map((r) => [r.registrationNumber, r]));
    expect(byReg.get('UP1')).toMatchObject({ distanceKm: 0, fuelLitres: 0 });
    expect(byReg.get('UP2')).toMatchObject({ distanceKm: 0, fuelLitres: 0 });
    expect(byReg.get('UP3')?.distanceKm).toBeGreaterThan(0);
    expect(byReg.get('UP3')?.fuelLitres).toBeGreaterThan(0);
  });

  it('keeps one bus consistently better or worse than its class across dates', () => {
    const fleet = fleetOf(BUSES);
    const factors = (day: string): Map<string, number> =>
      new Map(
        modelFuelDay(BUSES, fleet, day).map((d) => [
          d.registrationNumber,
          d.distanceKm / d.fuelLitres / FUEL_CLASS_KM_PER_LITRE[d.serviceClass],
        ]),
      );
    const one = factors(DAY_ONE);
    const two = factors(DAY_TWO);
    const maxSpread = FUEL_EFFICIENCY_SPREAD + FUEL_DAILY_NOISE + SLACK;
    let agreeing = 0;
    for (const [reg, factor] of one) {
      const other = two.get(reg) ?? 0;
      expect(Math.abs(factor - 1)).toBeLessThanOrEqual(maxSpread);
      expect(Math.abs(factor - other)).toBeLessThanOrEqual(2 * FUEL_DAILY_NOISE + SLACK);
      if (Math.sign(factor - 1) === Math.sign(other - 1)) agreeing += 1;
    }
    // A fresh draw each day would agree in sign about half the time.
    expect(agreeing).toBeGreaterThanOrEqual(one.size * 0.8);
  });

  it('rounds litres to one decimal and carries class and route', () => {
    const rows = modelFuelDay(BUSES, fleetOf(BUSES), DAY_ONE);
    expect(rows).toHaveLength(BUSES.length);
    for (const row of rows) {
      expect(Math.round(row.fuelLitres * 10) / 10).toBe(row.fuelLitres);
    }
    expect(rows.find((r) => r.routeName === 'PUNE_EXP_X')?.serviceClass).toBe('express');
  });

  it('does not mutate its inputs', () => {
    const fleet = fleetOf(BUSES);
    const frozen = Object.freeze(BUSES.map((b) => Object.freeze({ ...b })));
    expect(() => modelFuelDay(frozen, fleet, DAY_ONE)).not.toThrow();
  });
});
