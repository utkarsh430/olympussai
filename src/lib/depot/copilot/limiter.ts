import { MS_PER_DAY, MS_PER_HOUR } from '@/lib/depot/units';

/** Monotonic milliseconds: unlike the wall clock it never jumps back or forward. */
export const monotonicNow = (): number => performance.now();

export interface CallLimiter {
  /** Records a call and returns true when both windows have room; otherwise false. */
  tryAcquire(): boolean;
}

/**
 * Sliding-window cap on CLI calls, on an injected clock that defaults to the
 * monotonic one, so a wall-clock change can neither lock nor refill the budget. A call ages out of a
 * window exactly when the window's length has elapsed since it was made.
 */
export function createCallLimiter(options: {
  readonly now?: () => number;
  readonly perHour: number;
  readonly perDay: number;
}): CallLimiter {
  const clock = options.now ?? monotonicNow;
  let calls: readonly number[] = [];
  return {
    tryAcquire(): boolean {
      const now = clock();
      calls = calls.filter((t) => now - t < MS_PER_DAY);
      const inHour = calls.filter((t) => now - t < MS_PER_HOUR).length;
      if (inHour >= options.perHour || calls.length >= options.perDay) return false;
      calls = [...calls, now];
      return true;
    },
  };
}
