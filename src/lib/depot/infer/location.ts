import type { DepotBusRow } from '@/models/depotLive';
import { distanceM, hasUsablePosition } from './geo';
import type { LocatedBus, Yard } from './types';

const METRES_PER_KM = 1000;

const UNKNOWN: LocatedBus = { location: 'unknown', otherDepotId: null, distanceFromYardKm: null };

function oneDecimalKm(metres: number): number {
  return Math.round((metres / METRES_PER_KM) * 10) / 10;
}

/**
 * Place a bus against the learned yards.
 *
 * Its own yard is tested first, so depots that share one physical yard each
 * see their own buses as `in_yard` rather than `at_other_yard`. When a bus
 * sits in several other yards the nearest centre wins, then the lowest depot
 * id, so the result never depends on map insertion order.
 */
export function locateBus(row: DepotBusRow, yards: ReadonlyMap<string, Yard>): LocatedBus {
  if (!hasUsablePosition(row)) return UNKNOWN;
  const { latitude, longitude } = row;

  const homeYard = row.depotId === null ? undefined : yards.get(row.depotId);
  const homeMetres = homeYard
    ? distanceM(latitude, longitude, homeYard.lat, homeYard.lng)
    : null;
  const distanceFromYardKm = homeMetres === null ? null : oneDecimalKm(homeMetres);

  if (homeYard && homeMetres !== null && homeMetres <= homeYard.radiusM) {
    return { location: 'in_yard', otherDepotId: null, distanceFromYardKm };
  }

  let nearest: { readonly id: string; readonly metres: number } | null = null;
  for (const id of [...yards.keys()].sort()) {
    if (id === row.depotId) continue;
    const yard = yards.get(id);
    if (!yard) continue;
    const metres = distanceM(latitude, longitude, yard.lat, yard.lng);
    if (metres > yard.radiusM) continue;
    if (nearest === null || metres < nearest.metres) nearest = { id, metres };
  }
  if (nearest) {
    return { location: 'at_other_yard', otherDepotId: nearest.id, distanceFromYardKm };
  }

  if (homeYard) return { location: 'away', otherDepotId: null, distanceFromYardKm };
  return UNKNOWN;
}
