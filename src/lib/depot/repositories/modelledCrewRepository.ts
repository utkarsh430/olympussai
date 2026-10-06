import type { CrewRepository, CrewSlot } from '../crew/types';
import { modelCrew } from '../sim/crew';
import type { DepotSummary } from '../types';

/**
 * Crew until a real roster feed exists: modelled availability anchored on the
 * depot's duty count. Async so a roster adapter can replace it without
 * changing a caller. Screens label it MODELLED.
 */
export const modelledCrewRepository: CrewRepository = {
  async crewFor(
    depot: DepotSummary,
    shiftCount: number,
    operatingDate: string,
  ): Promise<readonly CrewSlot[]> {
    return modelCrew(depot, shiftCount, operatingDate);
  },
};
