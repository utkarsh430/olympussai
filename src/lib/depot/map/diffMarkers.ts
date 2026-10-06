import type { LatLng } from '@/lib/depot/types';

interface Positionable {
  readonly depot: { readonly id: string; readonly centroid: LatLng | null };
}

export interface MarkerDiff<T> {
  /** Positioned depots with no marker yet. */
  readonly add: readonly T[];
  /** Positioned depots that keep their marker, to move and restyle in place. */
  readonly update: readonly T[];
  /** Marker ids whose depot is gone or no longer positioned. */
  readonly remove: readonly string[];
}

/**
 * What a poll changes on the map, keyed by depot id, so markers are updated in
 * place instead of torn down: a hover or click mid-poll is never lost.
 */
export function diffMarkers<T extends Positionable>(
  previousIds: readonly string[],
  nextRows: readonly T[],
): MarkerDiff<T> {
  const previous = new Set(previousIds);
  const positioned = nextRows.filter((row) => row.depot.centroid !== null);
  const kept = new Set(positioned.map((row) => row.depot.id));
  return {
    add: positioned.filter((row) => !previous.has(row.depot.id)),
    update: positioned.filter((row) => previous.has(row.depot.id)),
    remove: previousIds.filter((id) => !kept.has(id)),
  };
}
