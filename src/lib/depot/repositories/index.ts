import { liveFleetRepository } from './liveFleetRepository';
import { modelledCrewRepository } from './modelledCrewRepository';
import { modelledFuelRepository } from './modelledFuelRepository';
import { modelledHistoryRepository } from './modelledHistoryRepository';
import { modelledRevenueRepository } from './modelledRevenueRepository';
import type { DepotRepositories } from './types';

const repositories: DepotRepositories = {
  fleet: liveFleetRepository,
  history: modelledHistoryRepository,
  crew: modelledCrewRepository,
  fuel: modelledFuelRepository,
  revenue: modelledRevenueRepository,
};

/**
 * The composition root for depot data. This is the one place a real feed or a
 * database is swapped in: write a new adapter behind one of the repository
 * interfaces (fleet, history, crew, fuel, revenue) and wire it here. Routes and
 * views never import an adapter directly.
 */
export function getRepositories(): DepotRepositories {
  return repositories;
}
