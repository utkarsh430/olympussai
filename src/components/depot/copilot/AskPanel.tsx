'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useDepotNetworkContext } from '@/components/depot/data/DepotNetworkProvider';
import { useCopilot } from '@/hooks/useCopilot';
import { MAX_QUESTION_CHARS } from '@/lib/depot/copilot/limits';
import {
  failureSentence,
  normaliseQuestion,
  validateQuestion,
} from '@/lib/depot/copilot/ui/copilotView';
import type { CopilotScope } from '@/lib/depot/copilot/wire';
import { AnswerPlaceholder, AnswerView, type AnswerEntry } from './AnswerView';
import { ExampleQuestions } from './ExampleQuestions';

const NETWORK_VALUE = 'network';
const MAX_HISTORY = 5;

interface PendingQuestion {
  readonly question: string;
  readonly scopeLabel: string;
}

/** Ask a plain-language question about the network or one depot. Nothing is stored. */
export function AskPanel() {
  const network = useDepotNetworkContext();
  const { state, request, reset } = useCopilot();
  const [text, setText] = useState('');
  const [scopeValue, setScopeValue] = useState(NETWORK_VALUE);
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState<readonly AnswerEntry[]>([]);
  const [pending, setPending] = useState<PendingQuestion | null>(null);
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
  const scope: CopilotScope = chosen ? { kind: 'depot', depotId: chosen.id } : { kind: 'network' };
  const scopeLabel = chosen ? chosen.name : 'Whole network';

  // A finished answer moves into the session list; the hook then returns to idle.
  useEffect(() => {
    if (state.status !== 'done' || !pending) return;
    const entry: AnswerEntry = {
      id: nextId.current,
      question: pending.question,
      scopeLabel: pending.scopeLabel,
      response: state.response,
    };
    nextId.current += 1;
    setPending(null);
    setHistory((previous) => [entry, ...previous].slice(0, MAX_HISTORY));
    setMessage('Answer ready below.');
    reset();
  }, [state, pending, reset]);

  const cooling = state.status === 'failed' && state.kind === 'rate_limited';
  const loading = state.status === 'loading';
  const remaining = MAX_QUESTION_CHARS - normaliseQuestion(text).length;

  const submit = (): void => {
    if (loading || cooling) return;
    const result = validateQuestion(text);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setMessage('');
    setPending({ question: result.question, scopeLabel });
    request({ task: 'ask', question: result.question, scope });
  };

  const fillExample = (example: string): void => {
    setText(example);
    setMessage('');
    textRef.current?.focus();
  };

  // One message at a time; the rate-limit countdown is on screen, not announced each second.
  const status =
    message ||
    (loading ? 'Writing…' : '') ||
    (state.status === 'failed' ? failureSentence(state.kind, state.secondsRemaining) : '');

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
        <ExampleQuestions depotName={chosen ? chosen.name : null} onPick={fillExample} />

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
              onChange={(event) => {
                setText(event.target.value);
                setMessage('');
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
                {remaining < 0 ? `${-remaining} over the limit` : `${remaining} characters left`}
              </span>
              {' · Enter to send, Shift+Enter for a new line.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={loading || cooling}
              className="hud-button disabled:cursor-not-allowed disabled:opacity-40"
            >
              Submit
            </button>
            <p role="status" className="min-w-0 font-mono text-[13px] text-depot-muted">
              {status}
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
        {history.length === 0 && !(loading && pending) ? (
          <p className="depot-prose" data-testid="ask-empty">
            No questions asked yet.
          </p>
        ) : (
          <ol className="flex min-w-0 flex-col gap-4">
            {loading && pending ? <AnswerPlaceholder question={pending.question} /> : null}
            {history.map((entry) => (
              <AnswerView key={entry.id} entry={entry} />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
