/**
 * Best-effort per-actor rate limit on copilot LLM calls (OWASP A06 —
 * "missing rate limits" is otherwise a real gap here: every copilot call
 * spends real Anthropic API budget, so an unbounded loop from one
 * compromised or careless ops session could run up real cost with no
 * guard). Deliberately a separate, smaller module rather than reusing
 * src/lib/auth/rate-limit.ts's failed-login limiter, since its semantics
 * are "FAILURES within a window" and this is "CALLS within a window"
 * regardless of outcome — every request that reaches the LLM counts,
 * successful or not, because every one of them costs money.
 *
 * Backed by the shared Redis store when REDIS_URL is set
 * (src/lib/redis/client.ts) and by the per-process Map below when it is
 * not, exactly like the auth limiter. The shared backend matters more here
 * than the "best-effort" framing suggests: on a serverless deploy the
 * per-process cap is really "20 calls per window PER WARM INSTANCE", so the
 * spend ceiling scales with concurrency — precisely the unbounded-cost
 * scenario this module exists to prevent.
 *
 * On a Redis outage this falls back to the in-process counter rather than
 * either denying every copilot request or waving them all through; see the
 * FAILURE POLICY block in src/lib/redis/client.ts. Denying would take the
 * control room's incident-explanation tooling offline during an
 * infrastructure incident; waving through would remove the only spend
 * ceiling. The per-instance cap is what this module enforced before the
 * shared store existed, so the fallback is a return to the prior baseline,
 * not a hole.
 */
import { retryAfterSecondsFromMs, tryRedis } from '@/lib/redis/client';
import { bumpWindow } from '@/lib/redis/window';

const MAX_CALLS_PER_WINDOW = 20;
const WINDOW_MS = 5 * 60 * 1000;

/** Key prefix in the shared store, keeping these counters clear of `rl:auth:`. */
const REDIS_PREFIX = 'rl:copilot:';

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

function sweep(current: number): void {
  if (windows.size < 512) return;
  for (const [key, entry] of windows) {
    if (entry.resetAt <= current) windows.delete(key);
  }
}

export interface CopilotRateLimitResult {
  limited: boolean;
  retryAfterSeconds: number;
}

/** Records one copilot call for `actorUserId` and reports whether they are now over the limit. Call once per request, before the LLM call. */
export async function recordCopilotCall(actorUserId: string): Promise<CopilotRateLimitResult> {
  const viaRedis = await tryRedis(async (redis) => {
    const { count, remainingMs } = await bumpWindow(redis, REDIS_PREFIX + actorUserId, WINDOW_MS);
    // `>` not `>=`: the 20th call in a window is still allowed and the 21st
    // is the one refused, matching the in-memory branch below exactly.
    if (count > MAX_CALLS_PER_WINDOW) {
      return { limited: true, retryAfterSeconds: retryAfterSecondsFromMs(remainingMs) };
    }
    return { limited: false, retryAfterSeconds: 0 };
  });
  if (viaRedis !== null) return viaRedis;

  const current = Date.now();
  sweep(current);

  const entry = windows.get(actorUserId);
  if (!entry || entry.resetAt <= current) {
    windows.set(actorUserId, { count: 1, resetAt: current + WINDOW_MS });
    return { limited: false, retryAfterSeconds: 0 };
  }

  entry.count += 1;
  if (entry.count > MAX_CALLS_PER_WINDOW) {
    return { limited: true, retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - current) / 1000)) };
  }
  return { limited: false, retryAfterSeconds: 0 };
}

/** Test-only: drop the in-process counters between cases. */
export function _resetInMemoryCopilotRateLimitForTests(): void {
  windows.clear();
}
