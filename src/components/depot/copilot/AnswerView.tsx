import type { CopilotApiResponse } from '@/lib/depot/copilot/wire';
import { AnswerTable } from './AnswerTable';
import { CopilotFooter } from './CopilotFooter';
import { CopilotText } from './CopilotText';

export interface AnswerEntry {
  readonly id: number;
  readonly question: string;
  readonly scopeLabel: string;
  readonly response: CopilotApiResponse;
}

const PLACEHOLDER_ROWS_PX: readonly number[] = [18, 20, 56, 56, 96];

/**
 * One question and its answer in the session list: the question, "Understood as"
 * as a muted mono line directly under it, the answer, its rows, then the shared
 * footer line. A refusal is an ordinary calm answer with no rows and no figures.
 * All server text is rendered as text.
 */
export function AnswerView({ entry }: { readonly entry: AnswerEntry }) {
  const { response } = entry;
  return (
    <li className="flex min-w-0 flex-col gap-2 border-t border-depot-line pt-3" data-testid="ask-answer">
      <p className="font-mono text-[13px] text-depot-muted">
        <span className="sr-only">Question: </span>
        <span className="break-words text-depot-ink">{entry.question}</span>{' '}
        <span className="text-depot-faint">({entry.scopeLabel})</span>
      </p>
      {response.interpretedAs ? (
        <p className="break-words font-mono text-[12px] text-depot-faint">
          Understood as: {response.interpretedAs}
        </p>
      ) : null}
      <CopilotText headline={response.headline} paragraphs={response.paragraphs} headingLevel={3} />
      {response.table ? (
        <AnswerTable table={response.table} caption={response.headline} />
      ) : null}
      <CopilotFooter
        provider={response.provider}
        notice={response.notice}
        generatedAt={response.generatedAt}
        cached={response.cached}
        facts={response.facts}
      />
    </li>
  );
}

/** Stands in for an answer while it is being written, at roughly its footprint. */
export function AnswerPlaceholder({ question }: { readonly question: string }) {
  return (
    <li aria-hidden className="flex min-w-0 flex-col gap-2 border-t border-depot-line pt-3">
      <p className="break-words font-mono text-[13px] text-depot-muted">{question}</p>
      {PLACEHOLDER_ROWS_PX.map((height, index) => (
        <div key={index} className="depot-skeleton" style={{ height }} />
      ))}
    </li>
  );
}
