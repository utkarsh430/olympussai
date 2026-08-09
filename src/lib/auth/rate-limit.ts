/**
 * Failed-login rate limiter (Section 12).
 *
 * Keyed on IP + normalized project name. 5 FAILED attempts per 15-minute
 * window — failures only, never successes: `checkRateLimit` runs BEFORE the
 * credential check and `recordFailure` runs only after one is rejected, so a
 * busy operator signing in correctly all day is never throttled. (The copilot
 * limiter in src/lib/copilot/rateLimit.ts counts calls regardless of outcome;
 * the two are deliberately not merged.)
 *
 * TWO BACKENDS, one behaviour:
 *
 *   - REDIS_URL set   -> counters live in the shared store
 *     (src/lib/redis/client.ts), so all instances of a multi-instance or
 *     serverless deploy enforce ONE budget and a cold start no longer wipes
 *     an attacker's tally. This is what makes the limiter a real control
 *     rather than a speed bump.
 *   - REDIS_URL unset -> the original per-process Map below, untouched. Local
 *     dev and the test suite need no Redis, and behaviour is bit-for-bit what
 *     it was before the shared store existed, with the same acknowledged
 *     limitation: per-instance, best-effort, reset by cold starts.
 *
 * When Redis is configured but unreachable, calls fall back to that same
 * in-process Map — never to "allowed". The full fail-open/fail-closed
 * reasoning lives in src/lib/redis/client.ts's FAILURE POLICY block; the
 * short version is that denying every login during a Redis outage would lock
 * an entire control room out of its own console, while skipping the limit
 * would hand a brute-forcer a switch to turn it off.
 */
import { retryAfterSecondsFromMs, tryRedis } from '@/lib/redis/client';
import { bumpWindow, clearWindow, readWindow } from '@/lib/redis/window';

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;

/** Key prefix in the shared store, so these counters cannot collide with the copilot limiter's. */
const REDIS_PREFIX = 'rl:auth:';

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

const NOT_LIMITED: RateLimitResult = { limited: false, retryAfterSeconds: 0 };

/** Check whether a key is currently rate-limited, without recording anything. */
export async function checkRateLimit(key: string): Promise<RateLimitResult> {
  const viaRedis = await tryRedis(async (redis) => {
    const { count, remainingMs } = await readWindow(redis, REDIS_PREFIX + key);
    if (count < MAX_FAILURES) return NOT_LIMITED;
    return { limited: true, retryAfterSeconds: retryAfterSecondsFromMs(remainingMs) };
  });
  if (viaRedis !== null) return viaRedis;

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
export async function recordFailure(key: string): Promise<RateLimitResult> {
  const viaRedis = await tryRedis(async (redis) => {
    const { count, remainingMs } = await bumpWindow(redis, REDIS_PREFIX + key, WINDOW_MS);
    const limited = count >= MAX_FAILURES;
    return {
      limited,
      retryAfterSeconds: limited ? retryAfterSecondsFromMs(remainingMs) : 0,
    };
  });
  if (viaRedis !== null) return viaRedis;

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

/**
 * Clear a key's failures (called on successful login).
 *
 * Clears BOTH backends unconditionally rather than one or the other: a key
 * whose failures were recorded locally during a Redis blip must not survive a
 * later successful login just because Redis came back in between.
 */
export async function clearFailures(key: string): Promise<void> {
  attempts.delete(key);
  await tryRedis(async (redis) => {
    await clearWindow(redis, REDIS_PREFIX + key);
    return true;
  });
}

/** Test-only: drop the in-process counters between cases. */
export function _resetInMemoryRateLimitForTests(): void {
  attempts.clear();
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
