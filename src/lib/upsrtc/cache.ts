/**
 * Tiny in-memory TTL cache with last-known-good retention.
 *
 * Two distinct concepts:
 *  - `fresh`  : within TTL, safe to serve directly.
 *  - `lastGood`: the most recent successful value, served (flagged stale) when
 *                upstream is unavailable so the control room never goes blank.
 *
 * A cache keyed on what callers ask for is given `maxKeys`, so it cannot grow
 * for the life of the process: past the bound the oldest key is dropped from
 * each map. Without it every key is kept, as a cache with one fixed key needs.
 */

export interface CacheEntry<T> {
  value: T;
  storedAt: number;
}

export interface TtlCacheOptions {
  /** Most keys each map holds; the oldest set goes first. Absent: no bound. */
  readonly maxKeys?: number;
}

export class TtlCache<T> {
  // Insertion order is the age: a key set again is deleted first, so it becomes the newest.
  private fresh = new Map<string, CacheEntry<T>>();
  private lastGood = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly options: TtlCacheOptions = {},
  ) {}

  get(key: string, now: number = Date.now()): T | null {
    const entry = this.fresh.get(key);
    if (!entry) return null;
    if (now - entry.storedAt > this.ttlMs) {
      // Expired entries are never served again; the last good copy is kept apart.
      this.fresh.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: string, value: T, now: number = Date.now()): void {
    const entry = { value, storedAt: now };
    this.setBounded(this.fresh, key, entry);
    this.setBounded(this.lastGood, key, entry);
  }

  getLastGood(key: string): CacheEntry<T> | null {
    return this.lastGood.get(key) ?? null;
  }

  ageMs(key: string, now: number = Date.now()): number | null {
    const entry = this.lastGood.get(key);
    if (!entry) return null;
    return now - entry.storedAt;
  }

  /** Keys held in each map. */
  sizes(): { readonly fresh: number; readonly lastGood: number } {
    return { fresh: this.fresh.size, lastGood: this.lastGood.size };
  }

  clear(): void {
    this.fresh.clear();
    this.lastGood.clear();
  }

  private setBounded(map: Map<string, CacheEntry<T>>, key: string, entry: CacheEntry<T>): void {
    map.delete(key);
    const { maxKeys } = this.options;
    if (maxKeys !== undefined && map.size >= maxKeys) {
      const oldest = map.keys().next();
      if (!oldest.done) map.delete(oldest.value);
    }
    map.set(key, entry);
  }
}
