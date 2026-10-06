import { CLI_FAILURE_THRESHOLD, type ProviderSetting } from '@/lib/depot/copilot/config';
import { renderDraft } from '@/lib/depot/copilot/render';
import {
  CopilotFailure,
  type CopilotDraft,
  type CopilotProvider,
  type CopilotRequest,
  type CopilotText,
  type FallbackReason,
} from '@/lib/depot/copilot/types';

export interface CopilotEngine {
  generate(request: CopilotRequest): Promise<CopilotText>;
}

export interface CopilotEngineDeps {
  readonly setting: ProviderSetting;
  /** Null when no CLI provider exists (for example on Vercel). */
  readonly cli: CopilotProvider | null;
  readonly scripted: CopilotProvider;
  readonly now: () => number;
  readonly cooldownMs: number;
}

/** A busy slot or a rejected draft says nothing about whether the CLI is healthy. */
const NO_COOLDOWN: readonly FallbackReason[] = ['busy', 'rejected_draft'];

/** One bad output or slow call is noise; only a run of them counts as an outage. */
const SOFT_FAILURES: readonly FallbackReason[] = ['timeout', 'invalid_output'];

/**
 * Chooses who writes the text. The CLI is tried when selected and healthy; any
 * failure falls back to the scripted draft, and a failing CLI is left alone
 * until the cool-down ends. `provider` and `fellBack` report what really happened.
 */
export function createCopilotEngine(deps: CopilotEngineDeps): CopilotEngine {
  let coolingUntil = 0;
  let softFailures = 0;

  function recordFailure(reason: FallbackReason): void {
    if (NO_COOLDOWN.includes(reason)) return;
    if (SOFT_FAILURES.includes(reason)) {
      softFailures += 1;
      if (softFailures < CLI_FAILURE_THRESHOLD) return;
    }
    softFailures = 0;
    coolingUntil = deps.now() + deps.cooldownMs;
  }

  async function scripted(
    request: CopilotRequest,
    fallbackReason: FallbackReason,
    fellBack: boolean,
  ): Promise<CopilotText> {
    const rendered = renderDraft(await deps.scripted.draft(request), request.facts);
    if (!rendered.ok) {
      throw new Error(`Scripted ${request.task} draft failed to render: ${rendered.reason}`);
    }
    return {
      headline: rendered.headline,
      paragraphs: rendered.paragraphs,
      provider: 'scripted',
      usedFactIds: rendered.usedFactIds,
      generatedAt: new Date(deps.now()).toISOString(),
      fellBack,
      fallbackReason,
    };
  }

  function failureReason(error: unknown): FallbackReason {
    return error instanceof CopilotFailure ? error.reason : 'error';
  }

  return {
    async generate(request: CopilotRequest): Promise<CopilotText> {
      const cli = deps.cli;
      if (deps.setting === 'scripted' || cli === null) {
        return scripted(request, 'not_selected', false);
      }
      if (deps.now() < coolingUntil) return scripted(request, 'cooling_down', true);

      let draft: CopilotDraft;
      try {
        draft = await cli.draft(request);
      } catch (error: unknown) {
        const reason = failureReason(error);
        recordFailure(reason);
        return scripted(request, reason, true);
      }
      softFailures = 0;

      const rendered = renderDraft(draft, request.facts);
      if (!rendered.ok) return scripted(request, 'rejected_draft', true);
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
