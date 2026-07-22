/**
 * Failed-login rate limiter (Section 12).
 *
 * Best-effort, in-memory, per-process. Keyed on IP + normalized project name.
 * 5 failed attempts per 15-minute sliding window.
 *
 * IMPORTANT: on serverless/multi-instance infrastructure this is best-effort
 * only — each instance keeps its own counters and cold starts reset them. It
 * raises the cost of brute force but is NOT a hard guarantee. Replace with a
 * shared store (Redis / Upstash) before treating it as a real control. It is
 * deliberately not presented as more secure than it is.
 */

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;

interface Attempt {
  count: number;
  /** Epoch ms when the current window expires. */
  resetAt: number;
}

const attempts = new Map<string, Attempt>();

function now(): number {
  return Date.now();
}

/** Opportunistic cleanup so the map cannot grow without bound. */
function sweep(current: number): void {
  if (attempts.size < 512) return;
  for (const [key, entry] of attempts) {
    if (entry.resetAt <= current) attempts.delete(key);
  }
}

export interface RateLimitResult {
  limited: boolean;
  /** Seconds until the window resets (only meaningful when limited). */
  retryAfterSeconds: number;
}

/** Check whether a key is currently rate-limited, without recording anything. */
export function checkRateLimit(key: string): RateLimitResult {
  const entry = attempts.get(key);
  const current = now();
  if (!entry || entry.resetAt <= current) {
    return { limited: false, retryAfterSeconds: 0 };
  }
  if (entry.count >= MAX_FAILURES) {
    return {
      limited: true,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - current) / 1000)),
    };
  }
  return { limited: false, retryAfterSeconds: 0 };
}

/** Record a failed attempt for a key and return the resulting state. */
export function recordFailure(key: string): RateLimitResult {
  const current = now();
  sweep(current);
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= current) {
    attempts.set(key, { count: 1, resetAt: current + WINDOW_MS });
    return { limited: false, retryAfterSeconds: 0 };
  }
  entry.count += 1;
  const limited = entry.count >= MAX_FAILURES;
  return {
    limited,
    retryAfterSeconds: limited
      ? Math.max(1, Math.ceil((entry.resetAt - current) / 1000))
      : 0,
  };
}

/** Clear a key's failures (called on successful login). */
export function clearFailures(key: string): void {
  attempts.delete(key);
}

/** Derive a best-effort client IP from proxy headers. */
export function clientIpFrom(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return headers.get('x-real-ip')?.trim() || 'unknown';
}
