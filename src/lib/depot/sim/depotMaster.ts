import { SeededRandom } from '../../simulation/seededRandom';
import type { DepotSummary } from '../types';
import {
  BUSES_PER_FUEL_POINT,
  BUSES_PER_WORKSHOP_BAY,
  PARKING_FACTOR_RANGE,
  STATIC_SEED_DATE,
} from './config';
import { seedFor } from './seed';
import type { ModelledDepotMaster } from './types';

/**
 * Parking, workshop and fuel capacity for a depot. A depot's yard and bays do
 * not change from day to day, which is why this takes no date: it is seeded by
 * depot id only.
 */
export function modelDepotMaster(depot: DepotSummary): ModelledDepotMaster {
  const fleet = Math.max(0, depot.fleet);
  const rng = new SeededRandom(seedFor(depot.id, STATIC_SEED_DATE, 'depot-master'));
  const factor = rng.float(PARKING_FACTOR_RANGE.min, PARKING_FACTOR_RANGE.max);
  return {
    depotId: depot.id,
    parkingCapacity: Math.max(fleet, Math.ceil(fleet * factor)),
    workshopBays: Math.max(1, Math.round(fleet / BUSES_PER_WORKSHOP_BAY)),
    fuelPoints: Math.max(1, Math.round(fleet / BUSES_PER_FUEL_POINT)),
  };
}
