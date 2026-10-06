import { answerScopeLabel } from '@/lib/depot/copilot/ui/answerLayout';
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
 * One question and its answer in the session list: the question on one line (mono 13px)
 * with a muted chip naming the scope the ANSWER used (from `answerScope`, not the form),
 * "Understood as" as a muted line directly under it, then the answer, its rows and the
 * shared footer. A refusal is an ordinary calm answer with no rows and no figures. All
 * server text is rendered as text.
 */
export function AnswerView({ entry }: { readonly entry: AnswerEntry }) {
  const { response } = entry;
  return (
    <li className="flex min-w-0 flex-col gap-2 border-t border-depot-line pt-3" data-testid="ask-answer">
      <div className="flex min-w-0 flex-col">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="sr-only">Question: </span>
          <span className="min-w-0 truncate font-mono text-[13px] text-depot-ink" title={entry.question}>
            {entry.question}
          </span>
          <span
            data-testid="ask-answer-scope"
            className="shrink-0 rounded-[3px] border border-depot-line px-1.5 font-mono text-[11px] leading-4 text-depot-muted"
          >
            <span className="sr-only">About: </span>
            {answerScopeLabel(response.answerScope, entry.scopeLabel)}
          </span>
        </div>
        {response.interpretedAs ? (
          <p className="depot-note mt-0.5 break-words" data-testid="ask-understood-as">
            {`Understood as: ${response.interpretedAs}`}
          </p>
        ) : null}
      </div>
      <div className="mt-1 min-w-0">
        <CopilotText headline={response.headline} paragraphs={response.paragraphs} headingLevel={3} />
      </div>
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
      <div className="truncate font-mono text-[13px] text-depot-muted">{question}</div>
      {PLACEHOLDER_ROWS_PX.map((height, index) => (
        <div key={index} className="depot-skeleton" style={{ height }} />
      ))}
    </li>
  );
}
