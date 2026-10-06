/**
 * Competition ranking ("1, 2, 2, 4"): a higher index ranks first, equal
 * indexes share a rank, and the next rank skips the shared places. Both
 * indexes are held at the one decimal they are shown at, so two depots shown
 * with the same index always share a rank and neither reads as ahead.
 */
export interface IndexedEntry {
  readonly id: string;
  readonly index: number;
}

/** Each entry's rank by id: one more than the number of entries with a higher index. */
export function competitionRanks(entries: readonly IndexedEntry[]): ReadonlyMap<string, number> {
  return new Map(
    entries.map((entry) => [
      entry.id,
      1 + entries.filter((other) => other.index > entry.index).length,
    ] as const),
  );
}
