'use client';

import { useMemo } from 'react';
import { useCopilot } from '@/hooks/useCopilot';
import { failureSentence, generatedAtText } from '@/lib/depot/copilot/ui/copilotView';
import type { CopilotApiRequest, CopilotScope } from '@/lib/depot/copilot/wire';
import { CopilotText } from './CopilotText';
import { FactChips } from './FactChips';
import { ProviderTag } from './ProviderTag';

export interface BriefingCardProps {
  readonly scope: CopilotScope;
  /** Heading of the card, for example "Network briefing" or "Depot briefing". */
  readonly title: string;
}

/** Failures worth a retry; the others (session, unknown depot, refused) will not change. */
const RETRYABLE: readonly string[] = ['rate_limited', 'unavailable', 'network', 'aborted'];
const PLACEHOLDER_ROWS_PX: readonly number[] = [20, 56, 56, 40];

function scopeKey(scope: CopilotScope): string {
  return scope.kind === 'depot' ? `depot:${scope.depotId}` : 'network';
}

function BriefingBody({ scope, title }: BriefingCardProps) {
  const { state, request } = useCopilot();
  const body = useMemo<CopilotApiRequest>(() => ({ task: 'briefing', scope }), [scope]);
  const write = (): void => request(body);

  return (
    <section aria-label={title} className="depot-panel min-w-0 p-4" data-testid="briefing-card">
      <h2 className="depot-label">{title}</h2>

      {state.status === 'idle' ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <p className="depot-prose max-w-prose">
            A briefing is a short written summary of the latest figures. It is advisory: it
            describes and recommends, it does not instruct.
          </p>
          <button type="button" onClick={write} className="hud-button">
            Write briefing
          </button>
        </div>
      ) : null}

      {state.status === 'loading' ? (
        <div role="status" aria-busy="true" className="mt-3 flex flex-col gap-2">
          <p className="font-mono text-[13px] text-depot-muted">Writing…</p>
          {PLACEHOLDER_ROWS_PX.map((height, index) => (
            <div key={index} aria-hidden className="depot-skeleton" style={{ height }} />
          ))}
        </div>
      ) : null}

      {state.status === 'done' ? (
        <div className="mt-3 flex flex-col gap-3">
          <CopilotText
            headline={state.response.headline}
            paragraphs={state.response.paragraphs}
            headingLevel={3}
          />
          <ProviderTag provider={state.response.provider} notice={state.response.notice} />
          <p className="font-mono text-[12px] text-depot-faint">
            {generatedAtText(state.response.generatedAt, state.response.cached)}
          </p>
          <FactChips facts={state.response.facts} />
          <div>
            <button type="button" onClick={write} className="hud-button">
              Write again
            </button>
          </div>
        </div>
      ) : null}

      {state.status === 'failed' ? (
        <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="depot-prose">{failureSentence(state.kind, state.secondsRemaining)}</p>
          {RETRYABLE.includes(state.kind) ? (
            <button
              type="button"
              onClick={write}
              disabled={state.kind === 'rate_limited'}
              className="hud-button disabled:cursor-not-allowed disabled:opacity-40"
            >
              Try again
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Self-contained briefing for the network or one depot. Nothing is requested
 * until the user presses "Write briefing", because each text may spend the
 * operator's quota. Keyed by scope, so a changed scope starts from idle and
 * the previous text (and any request still running) is discarded.
 */
export function BriefingCard({ scope, title }: BriefingCardProps) {
  return <BriefingBody key={scopeKey(scope)} scope={scope} title={title} />;
}
