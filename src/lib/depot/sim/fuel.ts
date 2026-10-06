import { SeededRandom } from '../../simulation/seededRandom';
import type { DepotBusView } from '../api';
import type { BusFuelDay } from '../fuel/types';
import { STATIC_SEED_DATE } from './config';
import { modelBus } from './fleetMaster';
import {
  FUEL_CLASS_DAILY_KM,
  FUEL_CLASS_KM_PER_LITRE,
  FUEL_DAILY_NOISE,
  FUEL_DISTANCE_SPREAD,
  FUEL_EFFICIENCY_SPREAD,
  FUEL_STANDING_DISTANCE_SHARE,
} from './fuelConfig';
import { seedFor } from './seed';
import type { ModelledBus } from './types';

const TENTH = 10;

function toTenths(value: number): number {
  return Math.round(value * TENTH) / TENTH;
}

/** Share of a full day's distance a bus in this state runs. */
function distanceShare(state: DepotBusView['state']): number {
  if (state === 'off_road' || state === 'dark') return 0;
  return state === 'standing' ? FUEL_STANDING_DISTANCE_SHARE : 1;
}

function fuelRowFor(
  view: DepotBusView,
  modelled: ModelledBus,
  operatingDate: string,
): BusFuelDay {
  const { registrationNumber, routeName } = view;
  const { serviceClass } = modelled;
  const share = distanceShare(view.state);
  const identity = { registrationNumber, serviceClass, routeName };
  if (share === 0) return { ...identity, distanceKm: 0, fuelLitres: 0 };

  // The lasting factor is seeded by registration alone so it holds across dates.
  const lasting = new SeededRandom(seedFor(registrationNumber, STATIC_SEED_DATE, 'fuel-efficiency'));
  const factor = 1 + lasting.float(-FUEL_EFFICIENCY_SPREAD, FUEL_EFFICIENCY_SPREAD);
  const daily = new SeededRandom(seedFor(registrationNumber, operatingDate, 'fuel-day'));
  const distanceKm = toTenths(
    FUEL_CLASS_DAILY_KM[serviceClass] *
      share *
      (1 + daily.float(-FUEL_DISTANCE_SPREAD, FUEL_DISTANCE_SPREAD)),
  );
  const kmPerLitre =
    FUEL_CLASS_KM_PER_LITRE[serviceClass] *
    factor *
    (1 + daily.float(-FUEL_DAILY_NOISE, FUEL_DAILY_NOISE));
  return { ...identity, distanceKm, fuelLitres: toTenths(distanceKm / kmPerLitre) };
}

/**
 * One MODELLED day of distance and fuel issue per bus. Deterministic per
 * registration and operating date; off-road and dark buses run nothing.
 * Output is sorted by registration so input order never matters.
 */
export function modelFuelDay(
  buses: readonly DepotBusView[],
  fleet: ReadonlyMap<string, ModelledBus>,
  operatingDate: string,
): BusFuelDay[] {
  return buses
    .map((view) =>
      fuelRowFor(
        view,
        fleet.get(view.registrationNumber) ?? modelBus(view.registrationNumber, view.routeName),
        operatingDate,
      ),
    )
    .sort((a, b) => a.registrationNumber.localeCompare(b.registrationNumber));
}
