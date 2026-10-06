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
 * Parking, workshop and fuel capacity for a depot. Seeded by depot id only:
 * a depot's yard does not change from day to day. `_operatingDate` is accepted
 * so a dated feed can be swapped in later without changing the signature.
 */
export function modelDepotMaster(
  depot: DepotSummary,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- reserved, see above
  _operatingDate: string,
): ModelledDepotMaster {
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
