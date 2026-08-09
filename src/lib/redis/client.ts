/**
 * Optional shared-Redis backend for this app's three process-local security
 * counters:
 *
 *   - src/lib/auth/rate-limit.ts     failed-login limiter (5 per 15 min)
 *   - src/lib/copilot/rateLimit.ts   copilot LLM call limiter (20 per 5 min)
 *   - src/lib/controlService/client.ts  control-service circuit breaker
 *
 * All three were module-scoped `Map`s: correct on one long-lived process,
 * worthless on the multi-instance/serverless topology this app actually
 * deploys to (each lambda keeps its own counters, and a cold start resets
 * them). This module is the shared store those three now use *when one is
 * configured*, and nothing at all when one is not.
 *
 * ---------------------------------------------------------------------------
 * CLIENT CHOICE: @upstash/redis, not ioredis
 * ---------------------------------------------------------------------------
 * The web app deploys to Vercel (docs/CONTROL_SERVICE_DEPLOYMENT.md: "This
 * does not change anything about the Next.js web app's own hosting
 * (Vercel)"), i.e. short-lived serverless function instances. ioredis holds a
 * long-lived TCP connection per client, which is the wrong shape there twice
 * over: every cold invocation pays a fresh TCP+AUTH handshake on the login
 * hot path, and a traffic spike opens one connection per concurrent instance,
 * which is exactly how a managed Redis hits its connection cap and starts
 * refusing — turning the rate limiter into the outage. @upstash/redis is a
 * stateless HTTPS client: one `fetch` per command, no connection pool to
 * exhaust, and it runs unchanged on the edge runtime if any of these callers
 * ever moves there. The cost is one HTTP round trip per command instead of
 * one pipelined RESP round trip, which is irrelevant next to the bcrypt
 * compare and the Supabase/Postgres call already on these paths.
 *
 * ---------------------------------------------------------------------------
 * CONFIGURATION
 * ---------------------------------------------------------------------------
 *   REDIS_URL    Upstash REST endpoint (https://<db>.upstash.io). UNSET =
 *                the whole Redis backend is off and every caller keeps its
 *                existing in-process behaviour, unchanged. Local dev and the
 *                test suite therefore need no Redis at all.
 *   REDIS_TOKEN  Upstash REST token for that endpoint.
 *
 * REDIS_URL is the single activation switch. REDIS_URL set without
 * REDIS_TOKEN is a misconfiguration, not a request to disable Redis: it is
 * reported once at error level and then treated exactly like an unreachable
 * Redis (see the failure policy below) rather than throwing, because a typo
 * in an env var must not turn every login into a 500.
 *
 * ---------------------------------------------------------------------------
 * FAILURE POLICY (fail open to Redis, never open to rate limiting)
 * ---------------------------------------------------------------------------
 * When Redis is configured but unreachable, every caller here DEGRADES TO ITS
 * OWN IN-PROCESS COUNTER rather than allowing the request outright or denying
 * it outright. Stated in the usual terms: this is fail-open with respect to
 * *Redis*, and fail-closed with respect to *rate limiting* — a request is
 * never waved through uncounted.
 *
 * Why not fail closed (deny while Redis is down): these limiters guard the
 * ops console of a transit control room. Failing closed on the login limiter
 * means one Redis outage locks out every dispatcher, depot controller and
 * pilot driver simultaneously, during precisely the degraded-infrastructure
 * window when they most need to get in — and it hands anyone who can reach
 * Redis a one-shot, whole-fleet denial of service. That is a strictly worse
 * incident than the one it prevents.
 *
 * Why not fail open (skip the limit while Redis is down): that is the failure
 * the ticket calls out — an attacker who can DoS Redis switches the
 * brute-force limiter off. Never acceptable for a credential endpoint.
 *
 * Degrading to the in-process counter avoids both. The attacker's cost does
 * not drop to zero; it drops to what this app enforced before this change
 * (5 failures per instance per window), which was the shipped, reviewed
 * baseline. Availability is unaffected. The same policy applies identically
 * at all three call sites — including the circuit breaker, where "degrade to
 * the per-process breaker" is likewise the pre-existing behaviour.
 *
 * The one thing that must NOT happen on a Redis outage is paying a failing
 * HTTP round trip on every single login. `tryRedis` therefore trips its own
 * tiny local breaker after a short failure streak and skips Redis entirely
 * for a cooldown, so an outage costs one probe per cooldown window instead of
 * one per request.
 */
import { Redis } from '@upstash/redis';

/**
 * The subset of the Redis command surface these counters use. Narrow on
 * purpose: it is the seam the tests substitute an in-memory fake for
 * (src/tests/helpers/fakeRedis.ts), so no test needs a live server, and it is
 * small enough that swapping @upstash/redis for another client later is a
 * one-file change.
 */
export interface RedisLike {
  get(key: string): Promise<unknown>;
  /** SET with NX+PX. Resolves truthy only when this call created the key. */
  set(key: string, value: string | number, opts: { nx: true; px: number }): Promise<unknown>;
  incr(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<unknown>;
  /** Remaining TTL in ms. Negative when the key is missing (-2) or has no TTL (-1). */
  pttl(key: string): Promise<number>;
  del(...keys: string[]): Promise<unknown>;
}

/** Consecutive `tryRedis` failures before this process stops calling Redis for a while. */
const LOCAL_BREAKER_THRESHOLD = 3;
/** How long Redis is skipped once the local breaker trips. */
const LOCAL_BREAKER_COOLDOWN_MS = 10_000;

let cachedClient: RedisLike | null | undefined;
let overrideClient: RedisLike | null | undefined;
let consecutiveErrors = 0;
let skipUntil = 0;
let reportedMissingToken = false;

/**
 * The configured client, or `null` when REDIS_URL is unset (or set without a
 * token). Constructed lazily and cached, so a process that never rate-limits
 * anything never builds one.
 */
export function getRedisClient(): RedisLike | null {
  if (overrideClient !== undefined) return overrideClient;
  if (cachedClient !== undefined) return cachedClient;

  const url = process.env.REDIS_URL?.trim();
  if (!url) {
    cachedClient = null;
    return cachedClient;
  }

  const token = process.env.REDIS_TOKEN?.trim();
  if (!token) {
    if (!reportedMissingToken) {
      reportedMissingToken = true;
      console.error(
        '[redis] REDIS_URL is set but REDIS_TOKEN is not — the shared rate-limit/circuit-breaker ' +
          'store is DISABLED and every caller has fallen back to its per-process counter. ' +
          'Set REDIS_TOKEN to restore shared enforcement.',
      );
    }
    cachedClient = null;
    return cachedClient;
  }

  cachedClient = new Redis({ url, token }) as unknown as RedisLike;
  return cachedClient;
}

/** True when a shared store is configured — used by tests and diagnostics, never to skip a limit. */
export function isRedisConfigured(): boolean {
  return getRedisClient() !== null;
}

/**
 * Runs one small command sequence against the shared store.
 *
 * Returns `null` — and only `null` — when the caller must fall back to its
 * own in-process counter: Redis is not configured, the local breaker is open,
 * or the command threw. Callers therefore branch on `null`, never on an
 * exception, and a `null` return is never allowed to mean "allowed".
 */
export async function tryRedis<T>(fn: (redis: RedisLike) => Promise<T>): Promise<T | null> {
  const redis = getRedisClient();
  if (!redis) return null;

  if (Date.now() < skipUntil) return null;

  try {
    const result = await fn(redis);
    consecutiveErrors = 0;
    return result;
  } catch (error) {
    consecutiveErrors += 1;
    if (consecutiveErrors >= LOCAL_BREAKER_THRESHOLD) {
      skipUntil = Date.now() + LOCAL_BREAKER_COOLDOWN_MS;
      consecutiveErrors = 0;
    }
    // Logged, never rethrown: the caller's fallback is the correct handling,
    // and a Redis blip must not surface as a 500 on a login.
    console.error('[redis] command failed; falling back to the in-process counter', error);
    return null;
  }
}

/**
 * Milliseconds-to-`Retry-After` conversion shared by both limiters, kept
 * byte-identical to the in-memory implementations' arithmetic so the two
 * backends cannot drift on the header value they produce.
 */
export function retryAfterSecondsFromMs(remainingMs: number): number {
  return Math.max(1, Math.ceil(remainingMs / 1000));
}

/**
 * Test-only: substitute a fake client (or `null` to force the in-memory
 * path) and clear the local breaker. Pass `undefined` to restore normal
 * env-driven construction.
 */
export function _setRedisClientForTests(client: RedisLike | null | undefined): void {
  overrideClient = client;
  cachedClient = undefined;
  consecutiveErrors = 0;
  skipUntil = 0;
  reportedMissingToken = false;
}
