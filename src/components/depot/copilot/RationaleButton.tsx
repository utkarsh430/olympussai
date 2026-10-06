'use client';

import { useId, useState } from 'react';
import { useCopilot } from '@/hooks/useCopilot';
import { failureSentence, generatedAtText } from '@/lib/depot/copilot/ui/copilotView';
import { CopilotText } from './CopilotText';
import { FactChips } from './FactChips';
import { ProviderTag } from './ProviderTag';

export interface RationaleButtonProps {
  readonly transferId: string;
  /** What the transfer is, for the accessible name: "Why? Kurla to Panvel, 4 buses". */
  readonly label: string;
}

const RETRYABLE: readonly string[] = ['rate_limited', 'unavailable', 'network', 'aborted'];

function RationaleInner({ transferId, label }: RationaleButtonProps) {
  const { state, request } = useCopilot();
  const [open, setOpen] = useState(false);
  const panelId = useId();

  const ask = (): void => request({ task: 'rationale', transferId });
  const toggle = (): void => {
    const next = !open;
    setOpen(next);
    // One request per expansion; text already fetched, or being fetched, is kept.
    if (next && state.status === 'idle') ask();
  };

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Why? ${label}`}
        className="hud-button px-2 py-0.5"
      >
        Why?
      </button>
      {/* Always mounted so the live region exists before its content changes. */}
      <div
        id={panelId}
        role="status"
        aria-live="polite"
        hidden={!open}
        className="mt-2 min-w-0 border-l border-depot-line pl-3"
        data-testid="rationale-panel"
      >
        {open && state.status === 'idle' ? (
          // Reached after a rate-limit wait ends: the sentence is gone, the way forward remains.
          <button type="button" onClick={ask} className="hud-button">
            Write the explanation
          </button>
        ) : null}
        {open && state.status === 'loading' ? (
          <p className="font-mono text-[13px] text-depot-muted">Writing…</p>
        ) : null}
        {open && state.status === 'done' ? (
          <div className="flex flex-col gap-2">
            <CopilotText
              headline={state.response.headline}
              paragraphs={state.response.paragraphs}
              headingLevel={4}
            />
            <ProviderTag provider={state.response.provider} notice={state.response.notice} />
            <p className="font-mono text-[12px] text-depot-faint">
              {generatedAtText(state.response.generatedAt, state.response.cached)}
            </p>
            <FactChips facts={state.response.facts} />
          </div>
        ) : null}
        {open && state.status === 'failed' ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="depot-prose">{failureSentence(state.kind, state.secondsRemaining)}</p>
            {RETRYABLE.includes(state.kind) ? (
              <button
                type="button"
                onClick={ask}
                disabled={state.kind === 'rate_limited'}
                className="hud-button disabled:cursor-not-allowed disabled:opacity-40"
              >
                Try again
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * "Why?" button that expands the explanation of one transfer beneath it. Keyed
 * by transfer so a row reused for another transfer starts closed and empty.
 */
export function RationaleButton(props: RationaleButtonProps) {
  return <RationaleInner key={props.transferId} {...props} />;
}
