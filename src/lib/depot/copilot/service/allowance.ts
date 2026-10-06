import type { FallbackReason } from '@/lib/depot/copilot/types';
import type { CopilotRuntime } from '@/lib/depot/copilot/service/runtime';
import type { LimitCheck } from '@/lib/depot/rateLimit';

/** Stands in for "all requests" in the one-key process limiter. */
const PROCESS_KEY = 'all';

/** Who is asking: the session's identity and, behind a trusted proxy, its address. */
export interface Caller {
  readonly identity: string;
  /** Null when `DEPOT_TRUSTED_IP_HEADER` is unset or the header is missing or malformed. */
  readonly address?: string | null;
}

/** Engine outcomes that mean Claude was never called, so the allowance is given back. */
export const NO_CALL_REASONS: readonly FallbackReason[] = [
  'cooling_down',
  'busy',
  'budget_exhausted',
];

/**
 * Ruling S37. Every request is counted per identity and for the process; with
 * a trusted address it is also counted per address ALONE, so a fresh login from
 * the same address (one shared PIN, any number of sessions) gains nothing.
 */
export function requestLimitChecks(
  runtime: CopilotRuntime,
  identity: string,
  address: string | null,
): readonly LimitCheck[] {
  return [
    { limiter: runtime.identityLimiter, key: identity },
    ...(address === null ? [] : [{ limiter: runtime.addressLimiter, key: address }]),
    { limiter: runtime.processLimiter, key: PROCESS_KEY },
  ];
}

function claudeChecks(runtime: CopilotRuntime, caller: Caller): readonly LimitCheck[] {
  const address = caller.address ?? null;
  return [
    { limiter: runtime.claudeAllowance, key: caller.identity },
    ...(address === null ? [] : [{ limiter: runtime.addressClaudeAllowance, key: address }]),
  ];
}

/** Spends one Claude call for the identity and its address, or neither when either is used up. */
export function takeClaudeAllowance(runtime: CopilotRuntime, caller: Caller): boolean {
  const checks = claudeChecks(runtime, caller);
  if (checks.some((c) => c.limiter.check(c.key).limited)) return false;
  checks.forEach((c) => c.limiter.take(c.key));
  return true;
}

/** Gives back what `takeClaudeAllowance` spent when no call was actually made. */
export function refundClaudeAllowance(runtime: CopilotRuntime, caller: Caller): void {
  claudeChecks(runtime, caller).forEach((c) => c.limiter.refund(c.key));
}
