import type { DepotBusView } from '../api';
import { BUS_LOCATION_LABEL } from '../labels';

/**
 * Where a bus is, in words. The roster row and the bus drawer each built this
 * sentence themselves; both must call this one function on the same bus view,
 * so a row can never read "Away, 14 km from yard" beside a drawer that reads
 * "Location unknown". The distance is given only for a bus away from a known
 * yard, in whole kilometres.
 */
export function busLocationText(
  bus: Pick<DepotBusView, 'location' | 'distanceFromYardKm'>,
): string {
  const label = BUS_LOCATION_LABEL[bus.location];
  if (bus.location !== 'away' || bus.distanceFromYardKm === null) return label;
  return `${label}, ${Math.round(bus.distanceFromYardKm).toLocaleString('en-IN')} km from yard`;
}
