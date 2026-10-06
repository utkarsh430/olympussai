import { UNAVAILABLE_DRAFT } from '@/lib/depot/copilot/resolve';
import type { CopilotRequest, CopilotText } from '@/lib/depot/copilot/types';
import type { CopilotApiResponse } from '@/lib/depot/copilot/wire';
import { logDepotError } from '@/lib/depot/log';
import { cacheKey } from '@/lib/depot/copilot/service/cache';
import { LOG_SCOPE } from '@/lib/depot/copilot/service/constants';
import type { Prepared } from '@/lib/depot/copilot/service/prepare';
import { toPublicResponse } from '@/lib/depot/copilot/service/publicResponse';
import type { CopilotRuntime } from '@/lib/depot/copilot/service/runtime';

type ReadyRequest = Extract<Prepared, { ok: true }>;

const DEADLINE = Symbol('deadline');

/** Resolves to DEADLINE at `deadlineAt`; the timer is cleared once the race settles. */
function raceDeadline<T>(
  work: Promise<T>,
  deadlineAt: number,
  now: number,
): Promise<T | typeof DEADLINE> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<typeof DEADLINE>((resolve) => {
    timer = setTimeout(() => resolve(DEADLINE), Math.max(0, deadlineAt - now));
  });
  return Promise.race([work, expiry]).finally(() => clearTimeout(timer));
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

/**
 * Writes the text for a prepared request and narrows it to the wire contract.
 *
 *  - A Claude text cached for the same task and facts is returned at once and
 *    spends no CLI budget. Only Claude texts are cached: a scripted fallback
 *    is cheap to redo and caching it would keep Claude out for the cache's life.
 *  - At `deadlineAt` the scripted answer goes out with the public notice. A
 *    Claude call still running finishes in the background (it holds its slot
 *    until the CLI's own timeout) and, if it succeeds, fills the cache.
 *  - Every failure ends in a scripted answer, logged once by reason code.
 */
export async function answerCopilot(
  runtime: CopilotRuntime,
  prepared: ReadyRequest,
  deadlineAt: number,
): Promise<CopilotApiResponse> {
  const { request } = prepared;
  const extras = { interpretedAs: prepared.interpretedAs, table: prepared.table };
  const missed = runtime.usesClaude || runtime.claudeExpected;
  const key = cacheKey(request);
  const hit = runtime.cache.get(key);
  if (hit) return toPublicResponse(hit, request, { ...extras, cached: true, claudeMissed: false });

  const work = runtime.engine.generate(request).then((text) => {
    if (text.provider === 'claude-cli') runtime.cache.set(key, text);
    return text;
  });
  let outcome: CopilotText | typeof DEADLINE;
  try {
    outcome = await raceDeadline(work, deadlineAt, runtime.now());
  } catch {
    logDepotError(LOG_SCOPE, 'engine_failed');
    const text = await scriptedText(runtime, request);
    return toPublicResponse(text, request, { ...extras, cached: false, claudeMissed: missed });
  }
  if (outcome === DEADLINE) {
    logDepotError(LOG_SCOPE, 'deadline');
    // The late result is either cached above or already logged by the engine.
    work.catch(() => undefined);
    const text = await scriptedText(runtime, request);
    return toPublicResponse(text, request, { ...extras, cached: false, claudeMissed: missed });
  }
  return toPublicResponse(outcome, request, {
    ...extras,
    cached: false,
    claudeMissed: runtime.claudeExpected,
  });
}
