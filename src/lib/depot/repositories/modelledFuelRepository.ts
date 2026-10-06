import type { BusFuelDay, FuelRepository } from '../fuel/types';
import { modelFuelDay } from '../sim/fuel';
import type { OperatingDay } from '../sim/operatingDayTypes';

/**
 * Fuel issue generated from the depot's modelled operating day: each bus that
 * ran is issued its duty's distance over its modelled economy. A real fuel feed
 * is a new adapter behind the same interface; the analysis never knows the
 * difference.
 */
export const modelledFuelRepository: FuelRepository = {
  async fuelDay(day: OperatingDay): Promise<readonly BusFuelDay[]> {
    return modelFuelDay(day);
  },
};
