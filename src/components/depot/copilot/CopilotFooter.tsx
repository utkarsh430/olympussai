'use client';

import { useId, useState } from 'react';
import { noticeSentence } from '@/lib/depot/copilot/ui/copilotView';
import type { CopilotFactView, CopilotPublicNotice, CopilotPublicProvider } from '@/lib/depot/copilot/wire';
import {
  OUTDATED_SENTENCE,
  figureWords,
  isOutdatedText,
  writerWord,
  writtenWords,
} from '@/lib/depot/copilotFooter';
import { FactList } from './FactChips';

export interface CopilotFooterProps {
  readonly provider: CopilotPublicProvider;
  readonly notice: CopilotPublicNotice;
  readonly generatedAt: string;
  readonly cached: boolean;
  readonly facts: readonly CopilotFactView[];
  /** The page's feed time when the text was requested. */
  readonly writtenFromFeedTime?: string | null;
  /** The page's current feed time; with the above, says when the text is behind the page. */
  readonly currentFeedTime?: string | null;
  /** Writes the text again; the outdated line offers it only when this is passed. */
  readonly onWriteAgain?: () => void;
}

/**
 * The single footer under copilot prose and any evidence table:
 * `SCRIPTED · written 14:00 · 18 figures`, the figures opening from the last part. A
 * fallback notice stays a sentence above it. Everything is a React text node; nothing
 * is requested on mount (writing again is the caller's, on a press only).
 */
export function CopilotFooter(props: CopilotFooterProps) {
  const { provider, notice, generatedAt, cached, facts, onWriteAgain } = props;
  const [open, setOpen] = useState(false);
  const listId = useId();
  const sentence = noticeSentence(notice);
  const outdated = isOutdatedText(props.writtenFromFeedTime ?? null, props.currentFeedTime ?? null);
  return (
    <div className="min-w-0" data-testid="copilot-footer">
      {sentence ? <p className="depot-prose mb-1">{sentence}</p> : null}
      <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-depot-muted">
        <span data-provider={provider} data-testid="copilot-provider">
          {writerWord(provider)}
        </span>
        {' · '}
        <span className="normal-case tracking-normal">{writtenWords(generatedAt, cached)}</span>
        {' · '}
        {facts.length === 0 ? (
          <span className="normal-case tracking-normal">{figureWords(0)}</span>
        ) : (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            onClick={() => setOpen((value) => !value)}
            className="normal-case tracking-normal text-holo-glow underline decoration-holo-glow/40 underline-offset-2 hover:decoration-holo-glow"
          >
            {figureWords(facts.length)}
          </button>
        )}
      </p>
      {open ? <FactList id={listId} facts={facts} /> : null}
      {outdated ? (
        <p role="status" className="mt-2 flex flex-wrap items-center gap-3 font-sans text-[13px] text-alert-amber">
          {OUTDATED_SENTENCE}
          {onWriteAgain ? (
            <button type="button" onClick={onWriteAgain} className="depot-filter-button">
              Write again
            </button>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
