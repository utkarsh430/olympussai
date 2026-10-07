import { liveFleetRepository } from './liveFleetRepository';
import { memoryHourlyObservationRepository } from './memoryHourlyObservationRepository';
import { memoryScheduledTripRepository } from './memoryScheduledTripRepository';
import { modelledCrewRepository } from './modelledCrewRepository';
import { modelledFuelRepository } from './modelledFuelRepository';
import { modelledHistoryRepository } from './modelledHistoryRepository';
import { modelledRevenueRepository } from './modelledRevenueRepository';
import type { DepotRepositories, ServiceRepositories } from './types';

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

const serviceRepositories: ServiceRepositories = {
  hourly: memoryHourlyObservationRepository,
  scheduled: memoryScheduledTripRepository,
};

/**
 * The hour-by-hour service stores: what this server observed of the date, and
 * the scheduled trips of the bus days looked up. In memory today; a database
 * adapter written by a sampler, or a timetable store, is wired here instead.
 */
export function getServiceRepositories(): ServiceRepositories {
  return serviceRepositories;
}
