export interface RateDecision {
  readonly limited: boolean;
  /** Seconds until a slot frees; 0 when not limited. */
  readonly retryAfterSeconds: number;
}

export interface WindowLimiter {
  /** Takes a slot for `key` when one is free; a refused request takes nothing. */
  take(key: string): RateDecision;
  /** Keys currently tracked (for the memory bound's test). */
  size(): number;
}

const MS_PER_SECOND = 1_000;

/**
 * Sliding-window request limiter, in memory, per process. Like the login
 * limiter it is best effort on multi-instance hosting; it exists so that one
 * process cannot be made to do unbounded work. Memory is bounded: past
 * `maxKeys` the least recently inserted key is forgotten.
 */
export function createWindowLimiter(options: {
  readonly now: () => number;
  readonly limit: number;
  readonly windowMs: number;
  readonly maxKeys: number;
}): WindowLimiter {
  const hits = new Map<string, readonly number[]>();

  function evictFor(key: string): void {
    if (hits.has(key) || hits.size < options.maxKeys) return;
    const oldest = hits.keys().next();
    if (!oldest.done) hits.delete(oldest.value);
  }

  return {
    take(key: string): RateDecision {
      const now = options.now();
      const recent = (hits.get(key) ?? []).filter((t) => now - t < options.windowMs);
      const first = recent[0];
      if (recent.length >= options.limit && first !== undefined) {
        hits.set(key, recent);
        const waitMs = first + options.windowMs - now;
        return { limited: true, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / MS_PER_SECOND)) };
      }
      evictFor(key);
      hits.set(key, [...recent, now]);
      return { limited: false, retryAfterSeconds: 0 };
    },
    size: () => hits.size,
  };
}
