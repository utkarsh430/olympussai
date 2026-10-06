import type { DepotBusRow } from '@/models/depotLive';
import { distanceM, hasUsablePosition } from './geo';
import type { LocatedBus, Yard } from './types';

const METRES_PER_KM = 1000;

const UNKNOWN: LocatedBus = { location: 'unknown', otherDepotId: null, distanceFromYardKm: null };

function oneDecimalKm(metres: number): number {
  return Math.round((metres / METRES_PER_KM) * 10) / 10;
}

type YardEntry = readonly [string, Yard];

/**
 * Yard entries in id order, built once per map. `locateBus` runs for every bus in a
 * snapshot, and the yards map is built once per snapshot and not changed after, so
 * sorting per call repeated the same work thousands of times. Keyed weakly by the map,
 * so a new map gets a fresh list and a dropped one is collected. The size is checked
 * so a map that was grown after first use is not answered from a stale list.
 */
const SORTED_ENTRIES = new WeakMap<ReadonlyMap<string, Yard>, readonly YardEntry[]>();

function sortedEntries(yards: ReadonlyMap<string, Yard>): readonly YardEntry[] {
  const cached = SORTED_ENTRIES.get(yards);
  if (cached && cached.length === yards.size) return cached;
  const entries = [...yards.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  SORTED_ENTRIES.set(yards, entries);
  return entries;
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
  for (const [id, yard] of sortedEntries(yards)) {
    if (id === row.depotId) continue;
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
