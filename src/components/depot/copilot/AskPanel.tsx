'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useDepotNetworkContext } from '@/components/depot/data/DepotNetworkProvider';
import { useCopilot } from '@/hooks/useCopilot';
import { MAX_QUESTION_CHARS } from '@/lib/depot/copilot/limits';
import {
  failureSentence,
  generatedAtText,
  normaliseQuestion,
  validateQuestion,
} from '@/lib/depot/copilot/ui/copilotView';
import type { CopilotApiResponse, CopilotScope } from '@/lib/depot/copilot/wire';
import { AnswerTable } from './AnswerTable';
import { CopilotText } from './CopilotText';
import { FactChips } from './FactChips';
import { ProviderTag } from './ProviderTag';

const NETWORK_VALUE = 'network';
const MAX_HISTORY = 5;

const EXAMPLES: readonly string[] = [
  'Which five depots rank highest on the efficiency index?',
  'Give me a summary of this depot.',
  'Which depots are short of buses?',
  'What exceptions does this depot have?',
];

interface AnswerEntry {
  readonly id: number;
  readonly question: string;
  readonly scopeLabel: string;
  readonly response: CopilotApiResponse;
}

interface PendingQuestion {
  readonly question: string;
  readonly scopeLabel: string;
}

function AnswerView({ entry }: { readonly entry: AnswerEntry }) {
  const { response } = entry;
  return (
    <li className="depot-panel flex min-w-0 flex-col gap-3 p-4" data-testid="ask-answer">
      <p className="font-mono text-[12px] text-depot-muted">
        <span className="depot-label">Question</span>{' '}
        <span className="break-words text-depot-ink">{entry.question}</span>{' '}
        <span className="text-depot-faint">({entry.scopeLabel})</span>
      </p>
      {response.interpretedAs ? (
        <p className="depot-prose">Understood as: {response.interpretedAs}</p>
      ) : null}
      <CopilotText headline={response.headline} paragraphs={response.paragraphs} headingLevel={3} />
      <ProviderTag provider={response.provider} notice={response.notice} />
      {response.table ? (
        <AnswerTable table={response.table} caption={response.interpretedAs ?? entry.question} />
      ) : null}
      <p className="font-mono text-[12px] text-depot-faint">
        {generatedAtText(response.generatedAt, response.cached)}
      </p>
      <FactChips facts={response.facts} />
    </li>
  );
}

/** Ask a plain-language question about the network or one depot. Nothing is stored. */
export function AskPanel() {
  const network = useDepotNetworkContext();
  const { state, request, reset } = useCopilot();
  const [text, setText] = useState('');
  const [scopeValue, setScopeValue] = useState(NETWORK_VALUE);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<readonly AnswerEntry[]>([]);
  const [announcement, setAnnouncement] = useState('');
  const pending = useRef<PendingQuestion | null>(null);
  const nextId = useRef(1);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const ids = { text: useId(), scope: useId(), help: useId() };

  const depots = useMemo(
    () =>
      [...(network.data?.depots ?? [])]
        .map((d) => ({ id: d.id, name: d.name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'en')),
    [network.data],
  );
  const chosen = depots.find((d) => d.id === scopeValue);
  const scope: CopilotScope = chosen
    ? { kind: 'depot', depotId: chosen.id }
    : { kind: 'network' };
  const scopeLabel = chosen ? chosen.name : 'Whole network';

  // A finished answer moves into the session list; the hook then returns to idle.
  useEffect(() => {
    if (state.status !== 'done' || !pending.current) return;
    const entry: AnswerEntry = {
      id: nextId.current,
      question: pending.current.question,
      scopeLabel: pending.current.scopeLabel,
      response: state.response,
    };
    nextId.current += 1;
    pending.current = null;
    setHistory((previous) => [entry, ...previous].slice(0, MAX_HISTORY));
    setAnnouncement('Answer ready below.');
    reset();
  }, [state, reset]);

  const cooling = state.status === 'failed' && state.kind === 'rate_limited';
  const busy = state.status === 'loading' || cooling;
  const check = validateQuestion(text);
  const remaining = MAX_QUESTION_CHARS - normaliseQuestion(text).length;

  const submit = (): void => {
    if (busy) return;
    const result = validateQuestion(text);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError(null);
    setAnnouncement('');
    pending.current = { question: result.question, scopeLabel };
    request({ task: 'ask', question: result.question, scope });
  };

  const fillExample = (example: string): void => {
    setText(example);
    setError(null);
    textRef.current?.focus();
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <section aria-labelledby={`${ids.text}-h`} className="flex min-w-0 flex-col gap-3">
        <h2 id={`${ids.text}-h`} className="depot-label">
          Ask a question
        </h2>
        <p className="depot-prose max-w-prose">
          You can ask about the whole network or one depot: rankings, a depot&apos;s summary,
          depots short of buses or with spare buses, transfers and exceptions. It does not answer
          questions about individual staff. Choose a depot below for questions about one depot.
        </p>
        <ul className="flex flex-wrap gap-2" aria-label="Example questions">
          {EXAMPLES.map((example) => (
            <li key={example} className="min-w-0">
              <button
                type="button"
                onClick={() => fillExample(example)}
                className="hud-button max-w-full whitespace-normal text-left normal-case tracking-normal"
              >
                {example}
              </button>
            </li>
          ))}
        </ul>

        <form
          className="flex min-w-0 flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor={ids.scope} className="depot-label">
              About
            </label>
            <select
              id={ids.scope}
              value={chosen ? chosen.id : NETWORK_VALUE}
              onChange={(event) => setScopeValue(event.target.value)}
              className="depot-field max-w-full sm:w-72"
            >
              <option value={NETWORK_VALUE}>Whole network</option>
              {depots.map((depot) => (
                <option key={depot.id} value={depot.id}>
                  {depot.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor={ids.text} className="depot-label">
              Your question
            </label>
            <textarea
              ref={textRef}
              id={ids.text}
              rows={3}
              value={text}
              aria-describedby={ids.help}
              aria-invalid={error ? true : undefined}
              onChange={(event) => {
                setText(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  submit();
                }
              }}
              className="depot-field w-full max-w-prose resize-y font-sans text-sm"
            />
            <p id={ids.help} className="font-mono text-[12px] text-depot-faint">
              <span className={remaining < 0 ? 'text-alert-crimson' : undefined}>
                {remaining < 0
                  ? `${-remaining} over the limit`
                  : `${remaining} characters left`}
              </span>
              {' · Enter to send, Shift+Enter for a new line.'}
            </p>
            {error ? (
              <p role="alert" className="font-mono text-[12px] text-alert-crimson">
                {error}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={busy || !check.ok}
              className="hud-button disabled:cursor-not-allowed disabled:opacity-40"
            >
              Submit
            </button>
            <p role="status" className="min-w-0 font-mono text-[13px] text-depot-muted">
              {state.status === 'loading' ? 'Writing…' : null}
              {state.status === 'failed'
                ? failureSentence(state.kind, state.secondsRemaining)
                : null}
              {state.status === 'idle' ? announcement : null}
            </p>
          </div>
        </form>
      </section>

      <section aria-labelledby={`${ids.text}-a`} className="flex min-w-0 flex-col gap-3">
        <h2 id={`${ids.text}-a`} className="depot-label">
          Answers this session
        </h2>
        <p className="depot-prose">
          The last {MAX_HISTORY} questions and answers stay on this page, newest first. Nothing is
          stored: they are gone when you leave or reload.
        </p>
        {history.length === 0 ? (
          <p className="depot-prose" data-testid="ask-empty">
            No questions asked yet.
          </p>
        ) : (
          <ol className="flex min-w-0 flex-col gap-4">
            {history.map((entry) => (
              <AnswerView key={entry.id} entry={entry} />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
