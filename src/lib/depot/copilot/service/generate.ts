import { UNAVAILABLE_DRAFT } from '@/lib/depot/copilot/resolve';
import type { CopilotRequest, CopilotText } from '@/lib/depot/copilot/types';
import type { CopilotApiResponse } from '@/lib/depot/copilot/wire';
import { logDepotError } from '@/lib/depot/log';
import { cacheKey } from '@/lib/depot/copilot/service/cache';
import { LOG_SCOPE } from '@/lib/depot/copilot/service/constants';
import { LEFT } from '@/lib/depot/copilot/service/inflight';
import type { Prepared } from '@/lib/depot/copilot/service/prepare';
import { toPublicResponse } from '@/lib/depot/copilot/service/publicResponse';
import type { CopilotRuntime } from '@/lib/depot/copilot/service/runtime';

type ReadyRequest = Extract<Prepared, { ok: true }>;

/** One request's terms for the text: when it must be done, and for whom. */
export interface AnswerCall {
  readonly deadlineAt: number;
  /** Aborts on the deadline or when the client disconnects. */
  readonly signal: AbortSignal;
  /** Canonical identity (`requestIdentity`), for the per-identity Claude allowance. */
  readonly identity: string;
  /** Server-written sentence for a stale snapshot; added outside the cache. */
  readonly staleSentence?: string;
}

/** The scripted answer; it cannot throw (the last resort is the fixed text). */
async function scriptedText(
  runtime: CopilotRuntime,
  request: CopilotRequest,
): Promise<CopilotText> {
  try {
    return await runtime.scriptedEngine.generate(request);
  } catch {
    logDepotError(LOG_SCOPE, 'scripted_failed');
    return {
      ...UNAVAILABLE_DRAFT,
      provider: 'scripted',
      usedFactIds: [],
      generatedAt: new Date(runtime.now()).toISOString(),
      fellBack: true,
      fallbackReason: 'scripted_unavailable',
    };
  }
}

/** Why Claude is not tried for this request, or null to try it. Spends the allowance. */
function skipClaude(runtime: CopilotRuntime, key: string, call: AnswerCall): string | null {
  if (!runtime.usesClaude || runtime.inflight.has(key)) return null;
  if (call.deadlineAt - runtime.now() < runtime.minClaudeMs) return 'no_time';
  if (runtime.claudeAllowance.take(call.identity).limited) return 'allowance_used';
  return null;
}

/** The request's signal, also aborted at `deadlineAt`; `dispose` clears the timer. */
function untilDeadline(signal: AbortSignal, waitMs: number) {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), Math.max(0, waitMs));
  return {
    signal: AbortSignal.any([signal, deadline.signal]),
    passed: (): boolean => deadline.signal.aborted,
    dispose: (): void => clearTimeout(timer),
  };
}

/** The engine's text, from the call for this key (joined or started); LEFT on abort. */
async function engineText(
  runtime: CopilotRuntime,
  request: CopilotRequest,
  key: string,
  signal: AbortSignal,
): Promise<CopilotText | typeof LEFT> {
  const start = async (callSignal: AbortSignal): Promise<CopilotText> => {
    const text = await runtime.engine.generate(request, callSignal);
    if (text.provider === 'claude-cli') runtime.cache.set(key, text);
    return text;
  };
  return runtime.inflight.join(key, start, signal);
}

/**
 * Writes the text for a prepared request and narrows it to the wire contract.
 *
 *  - A Claude text cached for the same task and facts is returned at once and
 *    spends nothing. Only Claude texts are cached.
 *  - Concurrent requests for the same key share one call. A new call is not
 *    started with too little time left or once the identity's Claude
 *    allowance is used; the answer is then scripted with the public notice.
 *  - The deadline or a disconnect aborts the request's wait; the call is
 *    killed when no request waits on it, so nothing late fills the cache.
 *  - Every failure ends in a scripted answer; one request logs at most one line.
 */
export async function answerCopilot(
  runtime: CopilotRuntime,
  prepared: ReadyRequest,
  call: AnswerCall,
): Promise<CopilotApiResponse> {
  const { request } = prepared;
  const extras = {
    interpretedAs: prepared.interpretedAs,
    table: prepared.table,
    staleSentence: call.staleSentence,
  };
  const missed = runtime.usesClaude || runtime.claudeExpected;
  const respond = (text: CopilotText, cached: boolean, claudeMissed: boolean) =>
    toPublicResponse(text, request, { ...extras, cached, claudeMissed });

  const key = cacheKey(request);
  const hit = runtime.cache.get(key);
  if (hit) return respond(hit, true, false);

  const skipped = skipClaude(runtime, key, call);
  if (skipped) {
    logDepotError(LOG_SCOPE, skipped);
    return respond(await scriptedText(runtime, request), false, true);
  }
  const wait = untilDeadline(call.signal, call.deadlineAt - runtime.now());
  let outcome: CopilotText | typeof LEFT;
  try {
    outcome = await engineText(runtime, request, key, wait.signal);
  } catch {
    logDepotError(LOG_SCOPE, 'engine_failed');
    return respond(await scriptedText(runtime, request), false, missed);
  } finally {
    wait.dispose();
  }
  if (outcome === LEFT) {
    logDepotError(LOG_SCOPE, wait.passed() ? 'deadline' : 'aborted');
    return respond(await scriptedText(runtime, request), false, missed);
  }
  return respond(outcome, false, runtime.claudeExpected);
}
