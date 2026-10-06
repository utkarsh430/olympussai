import { SeededRandom } from '../../simulation/seededRandom';
import { compareText } from '../fuel/compare';
import type { BusFuelDay } from '../fuel/types';
import { STATIC_SEED_DATE } from './config';
import {
  FUEL_CLASS_KM_PER_LITRE,
  FUEL_DAILY_NOISE,
  FUEL_EFFICIENCY_SPREAD,
} from './fuelConfig';
import type { DayRun, OperatingDay } from './operatingDayTypes';
import { seedFor } from './seed';
import { TENTH } from '@/lib/depot/units';

function toTenths(value: number): number {
  return Math.round(value * TENTH) / TENTH;
}

/**
 * The bus's modelled economy for the day: its class figure, moved by a lasting
 * factor seeded by registration alone (so one bus is consistently better or
 * worse on every date) and by a small daily noise.
 */
function kmPerLitreOf(run: DayRun, operatingDate: string): number {
  const lasting = new SeededRandom(seedFor(run.registrationNumber, STATIC_SEED_DATE, 'fuel-efficiency'));
  const daily = new SeededRandom(seedFor(run.registrationNumber, operatingDate, 'fuel-day'));
  return (
    FUEL_CLASS_KM_PER_LITRE[run.busClass] *
    (1 + lasting.float(-FUEL_EFFICIENCY_SPREAD, FUEL_EFFICIENCY_SPREAD)) *
    (1 + daily.float(-FUEL_DAILY_NOISE, FUEL_DAILY_NOISE))
  );
}

/**
 * One MODELLED day of distance and fuel issue for each bus that ran. The
 * distance is not drawn here: it is the bus's duty in the operating day (its
 * route out and back), so the fuel page and the revenue page add up to the same
 * kilometres. Fuel issued is that distance over the bus's modelled economy. A
 * bus that did not run has no row: it has no distance, not a distance of zero.
 * Sorted by registration.
 */
export function modelFuelDay(day: OperatingDay): BusFuelDay[] {
  return day.runs
    .map((run): BusFuelDay => ({
      registrationNumber: run.registrationNumber,
      serviceClass: run.busClass,
      routeName: run.routeName,
      distanceKm: run.distanceKm,
      fuelLitres: toTenths(run.distanceKm / kmPerLitreOf(run, day.operatingDate)),
    }))
    .sort((a, b) => compareText(a.registrationNumber, b.registrationNumber));
}
