import type { SnapshotAnalysis } from './analysis';

/**
 * The most bodies one memo keyed on query parameters holds for one snapshot.
 * The parameters are chosen by the caller (a window, a horizon, a scope), so
 * without a bound one signed-in browser looping over them grows the memo for
 * as long as the snapshot lives, which during an outage is the whole outage.
 * The pages ask for a handful of combinations, so 64 keeps every poll a hit.
 */
export const MAX_QUERY_BODIES_PER_SNAPSHOT = 64;

export interface QueryMemoOptions<T> {
  /** The most bodies held per snapshot; the oldest goes first. */
  readonly limit?: number;
  /** Whether a built value is worth holding; one that is not is dropped once it settles. */
  readonly keep?: (value: T) => boolean;
}

export interface QueryMemo<T> {
  /**
   * The body held for this key on this snapshot, or the one `build` starts. The
   * promise is held from the start, so concurrent first requests share one
   * build; one that fails, or settles on a value `keep` refuses, is dropped so
   * the next request tries again.
   */
  readonly hold: (analysis: SnapshotAnalysis, key: string, build: () => Promise<T>) => Promise<T>;
  /** How many bodies are held for this snapshot now. */
  readonly size: (analysis: SnapshotAnalysis) => number;
}

/**
 * A memo per snapshot analysis (so it goes with its snapshot) and per query key
 * within it, bounded at `limit` entries. Inserts go into the snapshot's own map
 * in place, never through a copy of it, so filling the memo stays linear; the
 * map's insertion order is the age order, so the oldest is the first key.
 */
export function queryMemo<T>(options: QueryMemoOptions<T> = {}): QueryMemo<T> {
  const limit = options.limit ?? MAX_QUERY_BODIES_PER_SNAPSHOT;
  const keep = options.keep ?? ((): boolean => true);
  const held = new WeakMap<SnapshotAnalysis, Map<string, Promise<T>>>();

  const drop = (byKey: Map<string, Promise<T>>, key: string, pending: Promise<T>): void => {
    if (byKey.get(key) === pending) byKey.delete(key);
  };

  const hold = (analysis: SnapshotAnalysis, key: string, build: () => Promise<T>): Promise<T> => {
    const byKey = held.get(analysis) ?? new Map<string, Promise<T>>();
    held.set(analysis, byKey);
    const existing = byKey.get(key);
    if (existing !== undefined) return existing;
    const pending = build();
    byKey.set(key, pending);
    while (byKey.size > limit) {
      const oldest = byKey.keys().next().value;
      if (oldest === undefined) break;
      byKey.delete(oldest);
    }
    pending.then(
      (value) => {
        if (!keep(value)) drop(byKey, key, pending);
      },
      () => drop(byKey, key, pending),
    );
    return pending;
  };

  return { hold, size: (analysis) => held.get(analysis)?.size ?? 0 };
}
