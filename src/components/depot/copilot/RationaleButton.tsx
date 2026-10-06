'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { useCopilot, type CopilotState } from '@/hooks/useCopilot';
import { failureSentence, generatedAtText } from '@/lib/depot/copilot/ui/copilotView';
import { CopilotText } from './CopilotText';
import { FactChips } from './FactChips';
import { ProviderTag } from './ProviderTag';

/** Failures worth a retry; the others will not change on a second attempt. */
const RETRYABLE: readonly string[] = ['rate_limited', 'unavailable', 'network', 'aborted'];

export interface RationaleControl {
  readonly expanded: boolean;
  readonly toggle: () => void;
  readonly retry: () => void;
  readonly state: CopilotState;
  /** Id shared by the toggle's `aria-controls` and the panel's `id`. */
  readonly panelId: string;
  /** Short live-region string; empty until the panel is open. */
  readonly status: string;
}

function statusFor(expanded: boolean, state: CopilotState): string {
  if (!expanded) return '';
  switch (state.status) {
    case 'loading':
      return 'Writing the explanation';
    case 'done':
      return 'Explanation ready';
    case 'failed':
      // The live countdown is shown on screen but not announced every second.
      return state.kind === 'rate_limited'
        ? 'Too many requests. Please wait.'
        : failureSentence(state.kind);
    case 'idle':
      return '';
  }
}

/**
 * State for one transfer's explanation, shared by the toggle and the panel so
 * a host table can place them in different cells and rows. One request per
 * expansion: collapsing keeps the text, so re-opening does not request again.
 * Switching to another transfer, or the same transfer with a different
 * recommended bus count, starts closed and empty: the text describes a plan.
 */
export function useRationale(transferId: string, planBuses?: number): RationaleControl {
  const { state, request, reset } = useCopilot();
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();

  useEffect(() => {
    reset();
    setExpanded(false);
  }, [transferId, planBuses, reset]);

  const ask = useCallback((): void => request({ task: 'rationale', transferId }), [request, transferId]);
  const toggle = useCallback((): void => {
    const next = !expanded;
    setExpanded(next);
    if (next && state.status === 'idle') ask();
  }, [expanded, state.status, ask]);

  return { expanded, toggle, retry: ask, state, panelId, status: statusFor(expanded, state) };
}

export interface RationaleToggleProps {
  readonly expanded: boolean;
  readonly onToggle: () => void;
  /** The panel's id, from `useRationale().panelId`. */
  readonly panelId: string;
  /** What the transfer is, for the accessible name: "Why? Kurla to Panvel, 4 buses". */
  readonly label: string;
  /** `useRationale().status`; announced politely beside the button. */
  readonly status: string;
}

/** The "Why?" button. Carries the page's live region, so it stays mounted while the panel opens. */
export function RationaleToggle({
  expanded,
  onToggle,
  panelId,
  label,
  status,
}: RationaleToggleProps) {
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={expanded ? panelId : undefined}
        aria-label={`Why? ${label}`}
        className="hud-button px-2 py-0.5"
      >
        Why?
      </button>
      <span role="status" className="sr-only" data-testid="rationale-status">
        {status}
      </span>
    </>
  );
}

export interface RationalePanelProps {
  readonly id: string;
  readonly expanded: boolean;
  readonly state: CopilotState;
  readonly onRetry: () => void;
  /** Heading level of the headline; omitted means no heading, only a bold line. */
  readonly headingLevel?: 2 | 3 | 4;
}

/**
 * The explanation: text, provider tag and figures. Renders nothing while
 * collapsed. A table host puts it in its own full-width row.
 */
export function RationalePanel({
  id,
  expanded,
  state,
  onRetry,
  headingLevel,
}: RationalePanelProps) {
  if (!expanded) return null;
  return (
    <div id={id} className="min-w-0 border-l border-depot-line pl-3" data-testid="rationale-panel">
      {state.status === 'idle' ? (
        // Reached after a rate-limit wait ends: the sentence is gone, the way forward remains.
        <button type="button" onClick={onRetry} className="hud-button">
          Write the explanation
        </button>
      ) : null}
      {state.status === 'loading' ? (
        <p className="font-mono text-[13px] text-depot-muted">Writing…</p>
      ) : null}
      {state.status === 'done' ? (
        <div className="flex flex-col gap-2">
          <CopilotText
            headline={state.response.headline}
            paragraphs={state.response.paragraphs}
            headingLevel={headingLevel ?? null}
          />
          <ProviderTag provider={state.response.provider} notice={state.response.notice} />
          <p className="font-mono text-[12px] text-depot-faint">
            {generatedAtText(state.response.generatedAt, state.response.cached)}
          </p>
          <FactChips facts={state.response.facts} />
        </div>
      ) : null}
      {state.status === 'failed' ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="depot-prose">{failureSentence(state.kind, state.secondsRemaining)}</p>
          {RETRYABLE.includes(state.kind) ? (
            <button
              type="button"
              onClick={onRetry}
              disabled={state.kind === 'rate_limited'}
              className="hud-button disabled:cursor-not-allowed disabled:opacity-40"
            >
              Try again
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export interface RationaleButtonProps {
  readonly transferId: string;
  /** The recommended bus count; a change resets the explanation. */
  readonly planBuses?: number;
  readonly label: string;
  readonly headingLevel?: 2 | 3 | 4;
}

/** Toggle and panel stacked, for hosts that are not tables. */
export function RationaleButton({
  transferId,
  planBuses,
  label,
  headingLevel,
}: RationaleButtonProps) {
  const rationale = useRationale(transferId, planBuses);
  return (
    <div className="min-w-0">
      <RationaleToggle
        expanded={rationale.expanded}
        onToggle={rationale.toggle}
        panelId={rationale.panelId}
        label={label}
        status={rationale.status}
      />
      <div className="mt-2">
        <RationalePanel
          id={rationale.panelId}
          expanded={rationale.expanded}
          state={rationale.state}
          onRetry={rationale.retry}
          headingLevel={headingLevel}
        />
      </div>
    </div>
  );
}
