/**
 * Tiny in-memory TTL cache with last-known-good retention.
 *
 * Two distinct concepts:
 *  - `fresh`  : within TTL, safe to serve directly.
 *  - `lastGood`: the most recent successful value, served (flagged stale) when
 *                upstream is unavailable so the control room never goes blank.
 */

export interface CacheEntry<T> {
  value: T;
  storedAt: number;
}

export class TtlCache<T> {
  private fresh = new Map<string, CacheEntry<T>>();
  private lastGood = new Map<string, CacheEntry<T>>();

  constructor(private readonly ttlMs: number) {}

  get(key: string, now: number = Date.now()): T | null {
    const entry = this.fresh.get(key);
    if (!entry) return null;
    if (now - entry.storedAt > this.ttlMs) return null;
    return entry.value;
  }

  set(key: string, value: T, now: number = Date.now()): void {
    const entry = { value, storedAt: now };
    this.fresh.set(key, entry);
    this.lastGood.set(key, entry);
  }

  getLastGood(key: string): CacheEntry<T> | null {
    return this.lastGood.get(key) ?? null;
  }

  ageMs(key: string, now: number = Date.now()): number | null {
    const entry = this.lastGood.get(key);
    if (!entry) return null;
    return now - entry.storedAt;
  }

  clear(): void {
    this.fresh.clear();
    this.lastGood.clear();
  }
}
