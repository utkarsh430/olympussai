import {
  defaultServiceHoldStore,
  heldBusesOnRoute,
  heldBusRegistrationsOnRoute,
  heldDepotHours,
  heldJourneysOnRoute,
  heldRouteHours,
  heldSummary,
  type ServiceHoldStore,
} from '../live/serviceHold';
import type {
  LedgerJourney,
  ObservedDepotHour,
  ObservedRouteHour,
  ObservedSummary,
} from '../service/types';
import type { HourlyObservationRepository } from './types';

/**
 * The hour-by-hour observation until a database exists: it reads the
 * per-process hold the snapshot analysis writes (`live/serviceHold.ts`), so it
 * knows only what this server has seen since it started. Async so a database
 * adapter can replace it without changing a caller. The store is read on every
 * call, never captured, so a reset for a test is seen at once.
 */
export function createMemoryHourlyObservationRepository(
  storeOf: ServiceHoldStore | (() => ServiceHoldStore) = defaultServiceHoldStore,
): HourlyObservationRepository {
  const store = (): ServiceHoldStore => (typeof storeOf === 'function' ? storeOf() : storeOf);
  return {
    async routeHours(routeName, operatingDate): Promise<readonly ObservedRouteHour[]> {
      return heldRouteHours(store(), routeName, operatingDate);
    },
    async depotHours(depotId, operatingDate): Promise<readonly ObservedDepotHour[]> {
      return heldDepotHours(store(), depotId, operatingDate);
    },
    async observedSummary(operatingDate): Promise<ObservedSummary | null> {
      return heldSummary(store(), operatingDate);
    },
    async distinctBusesOnRoute(routeName, operatingDate): Promise<number> {
      return heldBusesOnRoute(store(), routeName, operatingDate);
    },
    async busesOnRoute(routeName, operatingDate): Promise<readonly string[]> {
      return heldBusRegistrationsOnRoute(store(), routeName, operatingDate);
    },
    async journeysOnRoute(routeName, operatingDate): Promise<readonly LedgerJourney[]> {
      return heldJourneysOnRoute(store(), routeName, operatingDate);
    },
  };
}

export const memoryHourlyObservationRepository: HourlyObservationRepository =
  createMemoryHourlyObservationRepository();
