import type { Yard } from '../infer/types';
import { UNASSIGNED_DEPOT_ID, type DepotSummary, type LatLng } from '../types';
import type { DepotPositionKind } from './api';

export interface DepotPosition {
  readonly position: LatLng;
  readonly kind: DepotPositionKind;
}

/**
 * Where each depot's buses start and end their day: the inferred yard centre
 * where a yard is established, else the median position of the depot's buses
 * (a rougher stand-in, labelled as such). Depots with neither are absent. Uses
 * the shared analysis outputs only, never the yard inference itself.
 */
export function depotPositions(
  depots: readonly DepotSummary[],
  yards: ReadonlyMap<string, Yard>,
): ReadonlyMap<string, DepotPosition> {
  const found = new Map<string, DepotPosition>();
  for (const depot of depots) {
    if (depot.id === UNASSIGNED_DEPOT_ID) continue;
    const yard = yards.get(depot.id);
    if (yard) found.set(depot.id, { position: { lat: yard.lat, lng: yard.lng }, kind: 'yard' });
    else if (depot.centroid) found.set(depot.id, { position: depot.centroid, kind: 'median' });
  }
  return found;
}
