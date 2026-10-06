'use client';

import { useMemo, useState } from 'react';
import { useCopilot, type CopilotState } from '@/hooks/useCopilot';
import { failureSentence } from '@/lib/depot/copilot/ui/copilotView';
import type { CopilotApiRequest, CopilotScope } from '@/lib/depot/copilot/wire';
import { isOutdatedText } from '@/lib/depot/copilotFooter';
import { CopilotText } from './CopilotText';
import { CopilotFooter } from './CopilotFooter';

export interface BriefingCardProps {
  readonly scope: CopilotScope;
  /** Heading of the card, for example "Network briefing" or "Depot briefing". */
  readonly title: string;
  /**
   * The page's current feed time. The card keeps the one it had when the text was
   * requested, so the footer can say that the page has updated since and offer to write
   * again.
   */
  readonly currentFeedTime?: string | null;
  /**
   * The card sits inside a row or panel that already names it: it draws no label of its own
   * and not the answer's headline (one panel, one heading). The section keeps `title` as its
   * accessible name.
   */
  readonly embedded?: boolean;
}

/** Failures worth a retry; the others (session, unknown depot, refused) will not change. */
const RETRYABLE: readonly string[] = ['rate_limited', 'unavailable', 'network', 'aborted'];
const PLACEHOLDER_ROWS_PX: readonly number[] = [20, 56, 56, 40];

function scopeKey(scope: CopilotScope): string {
  return scope.kind === 'depot' ? `depot:${scope.depotId}` : 'network';
}

/** The short string the always-mounted live region carries; the text itself is not announced. */
function statusText(state: CopilotState): string {
  switch (state.status) {
    case 'loading':
      return 'Writing the briefing';
    case 'done':
      return 'Briefing ready';
    case 'failed':
      // The live countdown is shown on screen but not announced every second.
      return state.kind === 'rate_limited'
        ? 'Too many requests. Please wait.'
        : failureSentence(state.kind);
    case 'idle':
      return '';
  }
}

function BriefingBody({
  scope,
  title,
  currentFeedTime = null,
  embedded = false,
}: BriefingCardProps) {
  const { state, request } = useCopilot();
  const [writtenFrom, setWrittenFrom] = useState<string | null>(null);
  const body = useMemo<CopilotApiRequest>(() => ({ task: 'briefing', scope }), [scope]);
  const write = (): void => {
    setWrittenFrom(currentFeedTime);
    request(body);
  };
  // When the text is behind the page, the footer's line offers the one "Write again".
  const outdated = isOutdatedText(writtenFrom, currentFeedTime);

  return (
    <section aria-label={title} className="depot-panel min-w-0 p-4" data-testid="briefing-card">
      {embedded ? null : <h2 className="depot-label">{title}</h2>}
      <p role="status" className="sr-only" data-testid="briefing-status">
        {statusText(state)}
      </p>

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
        <div aria-hidden className="mt-3 flex flex-col gap-2">
          <p className="depot-note">Writing…</p>
          {PLACEHOLDER_ROWS_PX.map((height, index) => (
            <div key={index} className="depot-skeleton" style={{ height }} />
          ))}
        </div>
      ) : null}

      {state.status === 'done' ? (
        <div className="mt-3 flex flex-col gap-3">
          <CopilotText
            headline={state.response.headline}
            paragraphs={state.response.paragraphs}
            headingLevel={3}
            focusOnMount
            hideHeadline={embedded}
          />
          <CopilotFooter
            provider={state.response.provider}
            notice={state.response.notice}
            generatedAt={state.response.generatedAt}
            cached={state.response.cached}
            facts={state.response.facts}
            writtenFromFeedTime={writtenFrom}
            currentFeedTime={currentFeedTime}
            onWriteAgain={write}
          />
          {outdated ? null : (
            <div>
              <button type="button" onClick={write} className="hud-button">
                Write again
              </button>
            </div>
          )}
        </div>
      ) : null}

      {state.status === 'failed' ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
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
export function BriefingCard({ scope, title, currentFeedTime, embedded }: BriefingCardProps) {
  return (
    <BriefingBody
      key={scopeKey(scope)}
      scope={scope}
      title={title}
      currentFeedTime={currentFeedTime}
      embedded={embedded}
    />
  );
}
