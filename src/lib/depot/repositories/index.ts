import { liveFleetRepository } from './liveFleetRepository';
import { modelledHistoryRepository } from './modelledHistoryRepository';
import type { DepotRepositories } from './types';

const repositories: DepotRepositories = {
  fleet: liveFleetRepository,
  history: modelledHistoryRepository,
};

/**
 * The composition root for depot data. This is the one place a real feed or a
 * database is swapped in: write a new adapter behind `FleetRepository` or
 * `HistoryRepository` and wire it here. Routes and views never import an
 * adapter directly.
 */
export function getRepositories(): DepotRepositories {
  return repositories;
}
