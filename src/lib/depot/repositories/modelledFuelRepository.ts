import type { DepotBusView } from '../api';
import type { BusFuelDay, FuelRepository } from '../fuel/types';
import { modelBus } from '../sim/fleetMaster';
import { modelFuelDay } from '../sim/fuel';

/**
 * Fuel issue generated from the live fleet. A real fuel feed is a new adapter
 * behind the same interface; the analysis never knows the difference.
 */
export const modelledFuelRepository: FuelRepository = {
  async fuelDay(
    buses: readonly DepotBusView[],
    operatingDate: string,
  ): Promise<readonly BusFuelDay[]> {
    const fleet = new Map(
      buses.map((b) => [b.registrationNumber, modelBus(b.registrationNumber, b.routeName)]),
    );
    return modelFuelDay(buses, fleet, operatingDate);
  },
};
