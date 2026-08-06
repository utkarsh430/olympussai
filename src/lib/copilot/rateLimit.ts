/**
 * Best-effort per-actor rate limit on copilot LLM calls (OWASP A06 —
 * "missing rate limits" is otherwise a real gap here: every copilot call
 * spends real Anthropic API budget, so an unbounded loop from one
 * compromised or careless ops session could run up real cost with no
 * guard). In-memory, per-process, same acknowledged limitation as
 * src/lib/auth/rate-limit.ts's failed-login limiter (not a hard guarantee
 * on serverless/multi-instance infra) — deliberately a separate, smaller
 * module rather than reusing that one, since its semantics are
 * "failures within a window" and this is "calls within a window"
 * regardless of outcome.
 */

const MAX_CALLS_PER_WINDOW = 20;
const WINDOW_MS = 5 * 60 * 1000;

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
export function recordCopilotCall(actorUserId: string): CopilotRateLimitResult {
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
