const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export interface CallLimiter {
  /** Records a call and returns true when both windows have room; otherwise false. */
  tryAcquire(): boolean;
}

/**
 * Sliding-window cap on CLI calls, on an injected clock. A call ages out of a
 * window exactly when the window's length has elapsed since it was made.
 */
export function createCallLimiter(options: {
  readonly now: () => number;
  readonly perHour: number;
  readonly perDay: number;
}): CallLimiter {
  let calls: readonly number[] = [];
  return {
    tryAcquire(): boolean {
      const now = options.now();
      calls = calls.filter((t) => now - t < DAY_MS);
      const inHour = calls.filter((t) => now - t < HOUR_MS).length;
      if (inHour >= options.perHour || calls.length >= options.perDay) return false;
      calls = [...calls, now];
      return true;
    },
  };
}
