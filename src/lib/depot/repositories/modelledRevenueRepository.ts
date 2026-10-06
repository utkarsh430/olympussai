import type { RevenueRepository, RouteRidershipDay } from '../revenue/types';
import type { OperatingDay } from '../sim/operatingDayTypes';
import { modelRidershipDay } from '../sim/ridership';

/**
 * Ridership and revenue generated from the depot's modelled operating day: the
 * trips are its duties that ran. A ticketing feed is a new adapter behind the
 * same interface.
 */
export const modelledRevenueRepository: RevenueRepository = {
  async ridershipDay(day: OperatingDay): Promise<readonly RouteRidershipDay[]> {
    return modelRidershipDay(day);
  },
};
