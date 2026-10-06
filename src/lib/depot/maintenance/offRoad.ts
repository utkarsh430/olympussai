import type { DepotBusView } from '../api';
import { compareText } from '@/lib/depot/stats/order';
import { deviceFlags } from '../roster/rosterModel';
import type { OffRoadBus } from './api';

function toOffRoadBus(bus: DepotBusView): OffRoadBus {
  return {
    registrationNumber: bus.registrationNumber,
    vehicleStatus: bus.vehicleStatus,
    tripStatus: bus.tripStatus,
    gpsAgeMin: bus.gpsAgeMin,
    flags: deviceFlags(bus),
  };
}

/** Longest silent first; a bus with no known age goes last. */
function bySilence(a: OffRoadBus, b: OffRoadBus): number {
  const ageA = a.gpsAgeMin ?? -1;
  const ageB = b.gpsAgeMin ?? -1;
  return ageB - ageA || compareText(a.registrationNumber, b.registrationNumber);
}

/**
 * The buses the feed reports under maintenance, from the depot detail's bus
 * list. The page reads that list from the depot detail context, so the live
 * off-road list is the one the page header counts.
 */
export function offRoadBusesFrom(buses: readonly DepotBusView[]): OffRoadBus[] {
  return buses
    .filter((bus) => bus.state === 'off_road')
    .map(toOffRoadBus)
    .sort(bySilence);
}
