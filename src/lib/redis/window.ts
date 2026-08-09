/**
 * The one Redis primitive both rate limiters are built from: a counter that
 * lives for exactly one window, pinned by the FIRST event in that window.
 *
 * This reproduces the in-memory limiters' semantics rather than inventing
 * better ones. Both existing modules keep `{ count, resetAt }` and set
 * `resetAt = now + WINDOW_MS` only when opening a new window — a later event
 * inside the window increments the count but never pushes `resetAt` out. The
 * Redis equivalent is `SET key 1 NX PX windowMs` (opens the window) followed
 * by `INCR` (extends the count, never the TTL), and `PTTL` is the exact
 * analogue of `resetAt - now`.
 *
 * Deliberately NOT a true rolling-log sliding window (a sorted set of event
 * timestamps trimmed on read). That would be a behaviour change — stricter,
 * but different from what the auth and copilot routes have been enforcing and
 * what their tests assert. Matching the shipped semantics is the requirement;
 * changing them is a separate decision.
 */
import type { RedisLike } from './client';

export interface WindowState {
  /** Events recorded in the current window, including the one that just happened. */
  count: number;
  /** Milliseconds until the window resets. `0` when no window is open. */
  remainingMs: number;
}

/**
 * Reads the current window without recording anything — the analogue of
 * `checkRateLimit`'s read-only Map lookup.
 *
 * Returns a zeroed state when no window is open, which is the same "not
 * limited" answer the in-memory version gives for a missing or elapsed entry.
 */
export async function readWindow(redis: RedisLike, key: string): Promise<WindowState> {
  const raw = await redis.get(key);
  const count = Number(raw ?? 0);
  if (!Number.isFinite(count) || count <= 0) return { count: 0, remainingMs: 0 };

  const ttl = await redis.pttl(key);
  // pttl < 0 means the key vanished between the two commands (-2) or somehow
  // carries no expiry (-1). Either way there is no window to report, and
  // reporting one would mean answering "limited" with a bogus Retry-After.
  if (ttl <= 0) return { count: 0, remainingMs: 0 };

  return { count, remainingMs: ttl };
}

/**
 * Records one event and returns the resulting window state.
 *
 * `SET NX PX` and `INCR` are two commands rather than one Lua script so that
 * the fake client the tests drive stays a plain object with no interpreter in
 * it. The interleaving that costs is narrow and benign: two concurrent first
 * events can both see the key absent, one wins the `SET`, the other's `INCR`
 * still lands on the winner's key, so no event is lost. The reverse gap —
 * the key expiring between a failed `SET NX` and the `INCR`, which would
 * leave a counter with no TTL and lock a key out permanently — is closed
 * explicitly by the `ttl < 0` repair below.
 */
export async function bumpWindow(
  redis: RedisLike,
  key: string,
  windowMs: number,
): Promise<WindowState> {
  const opened = await redis.set(key, 1, { nx: true, px: windowMs });
  if (opened) return { count: 1, remainingMs: windowMs };

  const count = await redis.incr(key);
  let ttl = await redis.pttl(key);
  if (ttl < 0) {
    await redis.pexpire(key, windowMs);
    ttl = windowMs;
  }
  return { count, remainingMs: ttl };
}

/** Drops the window entirely — the analogue of `clearFailures`' `Map.delete`. */
export async function clearWindow(redis: RedisLike, key: string): Promise<void> {
  await redis.del(key);
}
