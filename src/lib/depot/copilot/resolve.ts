import { CLI_WINDOW, CLI_WINDOW_FAILURES, type ProviderSetting } from '@/lib/depot/copilot/config';
import { monotonicNow } from '@/lib/depot/copilot/limiter';
import { renderDraft } from '@/lib/depot/copilot/render';
import { logDepotError } from '@/lib/depot/log';
import { describeCopilotError, withheldStrings } from '@/lib/depot/copilot/errorText';
import {
  CopilotFailure,
  type CopilotDraft,
  type CopilotProvider,
  type CopilotRequest,
  type CopilotText,
  type FallbackReason,
} from '@/lib/depot/copilot/types';

export interface CopilotEngine {
  generate(
    request: CopilotRequest,
    signal?: AbortSignal,
    canStart?: () => boolean,
  ): Promise<CopilotText>;
}

export interface CopilotEngineDeps {
  readonly setting: ProviderSetting;
  /** Null when no CLI provider exists (for example on Vercel). */
  readonly cli: CopilotProvider | null;
  readonly scripted: CopilotProvider;
  /** Wall clock, used only to stamp `generatedAt`. */
  readonly now: () => number;
  /** Clock for the cool-down; defaults to a monotonic one, immune to wall-clock jumps. */
  readonly monotonicNow?: () => number;
  readonly cooldownMs: number;
}

/** Shown only if the scripted draft cannot render; it must pass `renderDraft` with no facts. */
export const UNAVAILABLE_DRAFT: CopilotDraft = {
  headline: 'Briefing unavailable',
  paragraphs: ['A written summary could not be prepared. The figures on this page are not affected.'],
};

/** The CLI was never called, or says nothing about its health: not an attempt. */
const NOT_AN_ATTEMPT: readonly FallbackReason[] = [
  'busy',
  'budget_exhausted',
  'request_rejected',
  'aborted',
];
/** Count in the rolling window rather than cooling down on their own. */
const SOFT_FAILURES: readonly FallbackReason[] = [
  'timeout',
  'invalid_output',
  'rejected_draft',
  // Unclassified: one odd exit must not lock the CLI out for every user.
  'error',
];

/**
 * Chooses who writes the text. Only not_installed, not_authenticated and
 * usage_limit cool it down at once; soft
 * ones (timeout, bad output, a draft the renderer rejects) count in a rolling
 * window of the last CLI_WINDOW attempts and cool it down at CLI_WINDOW_FAILURES.
 * A success never resets the window, so a prompt that makes most drafts fail
 * cannot spend on every request forever. `provider` and `fellBack` are truthful.
 */
export function createCopilotEngine(deps: CopilotEngineDeps): CopilotEngine {
  const mono = deps.monotonicNow ?? monotonicNow;
  let coolingUntil = Number.NEGATIVE_INFINITY;
  let window: readonly boolean[] = []; // true = failed attempt

  function startCooldown(): void {
    window = [];
    coolingUntil = mono() + deps.cooldownMs;
  }

  function recordAttempt(failed: boolean): void {
    window = [...window, failed].slice(-CLI_WINDOW);
    if (window.filter(Boolean).length >= CLI_WINDOW_FAILURES) startCooldown();
  }

  function recordFailure(reason: FallbackReason): void {
    if (NOT_AN_ATTEMPT.includes(reason)) return;
    if (SOFT_FAILURES.includes(reason)) recordAttempt(true);
    else startCooldown();
  }

  async function scripted(
    request: CopilotRequest,
    fallbackReason: FallbackReason,
    fellBack: boolean,
  ): Promise<CopilotText> {
    const generatedAt = new Date(deps.now()).toISOString();
    // Nothing the scripted provider or the renderer throws may escape the fallback.
    let rendered: ReturnType<typeof renderDraft>;
    let thrown = '';
    try {
      rendered = renderDraft(await deps.scripted.draft(request), request.facts);
    } catch (error: unknown) {
      rendered = { ok: false, reason: 'threw' };
      // The scripted writer never handles model output: its error is worth logging, with
      // the fact values blanked.
      const withheld = withheldStrings({ facts: request.facts });
      thrown = `: ${describeCopilotError(error, withheld)}`;
    }
    if (!rendered.ok) {
      // A feed-driven condition must not turn the fallback into a server error.
      logDepotError(
        'copilot',
        `scripted ${request.task} draft failed: ${rendered.reason}${thrown}`,
      );
      return {
        headline: UNAVAILABLE_DRAFT.headline,
        paragraphs: UNAVAILABLE_DRAFT.paragraphs,
        provider: 'scripted',
        usedFactIds: [],
        generatedAt,
        fellBack,
        fallbackReason: 'scripted_unavailable',
      };
    }
    return {
      headline: rendered.headline,
      paragraphs: rendered.paragraphs,
      provider: 'scripted',
      usedFactIds: rendered.usedFactIds,
      generatedAt,
      fellBack,
      fallbackReason,
    };
  }

  return {
    async generate(
    request: CopilotRequest,
    signal?: AbortSignal,
    canStart?: () => boolean,
  ): Promise<CopilotText> {
      const cli = deps.cli;
      if (deps.setting === 'scripted' || cli === null) {
        return scripted(request, 'not_selected', false);
      }
      if (mono() < coolingUntil) return scripted(request, 'cooling_down', true);

      let draft: CopilotDraft;
      try {
        draft = await cli.draft(request, signal, canStart);
      } catch (error: unknown) {
        const reason: FallbackReason = error instanceof CopilotFailure ? error.reason : 'error';
        // An abort is logged by whoever aborted, once; logging it here would double it.
        if (reason !== 'aborted') logDepotError('copilot', `claude-cli fell back: ${reason}`);
        recordFailure(reason);
        return scripted(request, reason, true);
      }

      const rendered = renderDraft(draft, request.facts);
      if (!rendered.ok) {
        logDepotError('copilot', 'claude-cli fell back: rejected_draft');
        recordAttempt(true);
        return scripted(request, 'rejected_draft', true);
      }
      recordAttempt(false);
      return {
        headline: rendered.headline,
        paragraphs: rendered.paragraphs,
        provider: cli.id,
        usedFactIds: rendered.usedFactIds,
        generatedAt: new Date(deps.now()).toISOString(),
        fellBack: false,
        fallbackReason: null,
      };
    },
  };
}
