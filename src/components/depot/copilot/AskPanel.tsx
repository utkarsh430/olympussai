'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useDepotNetworkContext } from '@/components/depot/data/DepotNetworkProvider';
import { Select } from '@/components/depot/shell/Controls';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { useCopilot } from '@/hooks/useCopilot';
import { MAX_QUESTION_CHARS } from '@/lib/depot/copilot/limits';
import {
  failureSentence,
  limitSentence,
  normaliseQuestion,
  sessionNote,
  validateQuestion,
} from '@/lib/depot/copilot/ui/copilotView';
import { scopeMismatchLine } from '@/lib/depot/copilot/ui/answerLayout';
import type { CopilotScope } from '@/lib/depot/copilot/wire';
import { AnswerPlaceholder, AnswerView, type AnswerEntry } from './AnswerView';
import { ExampleQuestions } from './ExampleQuestions';

const NETWORK_VALUE = 'network';
const MAX_HISTORY = 5;
const RATE_LIMIT_SENTENCE = 'Too many requests. Please wait.';

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
  // The last answer's scope and the form's never silently disagree.
  const mismatch = scopeMismatchLine(history[0]?.response.answerScope, {
    depotId: chosen ? chosen.id : null,
    label: scopeLabel,
  });

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

  // One message at a time. The live region holds only constant sentences; the rate-limit
  // countdown changes every second, so it sits in its own element that is not live.
  const status =
    message ||
    (loading ? 'Writing…' : '') ||
    (cooling ? RATE_LIMIT_SENTENCE : '') ||
    (state.status === 'failed' ? failureSentence(state.kind) : '');
  const countdown =
    cooling && state.status === 'failed'
      ? `Try again in ${state.secondsRemaining} ${state.secondsRemaining === 1 ? 'second' : 'seconds'}.`
      : '';

  return (
    <div className="grid min-w-0 gap-8 xl:grid-cols-[minmax(0,62ch)_320px] xl:items-start">
      <div className="flex min-w-0 flex-col gap-6">
        <section aria-labelledby={`${ids.text}-h`} className="flex min-w-0 flex-col gap-3">
          <h2 id={`${ids.text}-h`} className="sr-only">
            Ask a question
          </h2>
          <form
            className="flex min-w-0 flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <Select
              label="About"
              value={chosen ? chosen.id : NETWORK_VALUE}
              onChange={(event) => setScopeValue(event.target.value)}
            >
              <option value={NETWORK_VALUE}>Whole network</option>
              {depots.map((depot) => (
                <option key={depot.id} value={depot.id}>
                  {depot.name}
                </option>
              ))}
            </Select>
            {mismatch ? (
              <p className="depot-note min-w-0" data-testid="ask-scope-mismatch">
                {mismatch}
              </p>
            ) : null}

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
                className="depot-field min-h-[88px] w-full resize-y font-sans text-sm"
              />
              <p id={ids.help} className="depot-note">
                <span className={remaining < 0 ? 'text-alert-crimson' : undefined}>
                  {limitSentence(remaining)}
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
              <p role="status" className="depot-note min-w-0">
                {status}
              </p>
              {countdown ? (
                <p data-testid="ask-countdown" className="depot-note min-w-0">
                  {countdown}
                </p>
              ) : null}
            </div>
          </form>
        </section>

        {history.length === 0 && !(loading && pending) ? (
          <p className="sr-only" data-testid="ask-empty">
            No questions asked yet.
          </p>
        ) : (
          <section aria-labelledby={`${ids.text}-a`} className="flex min-w-0 flex-col gap-3">
            <SectionLabel
              id={`${ids.text}-a`}
              label="Answers"
              count={history.length || undefined}
            />
            <ol className="flex min-w-0 flex-col gap-5">
              {loading && pending ? <AnswerPlaceholder question={pending.question} /> : null}
              {history.map((entry) => (
                <AnswerView key={entry.id} entry={entry} />
              ))}
            </ol>
            <p className="depot-note">{sessionNote(MAX_HISTORY)}</p>
          </section>
        )}
      </div>
      {/* At 1280px and wider a 320px right column beside the form; it keeps its label after an answer. */}
      <aside
        aria-labelledby={`${ids.text}-t`}
        className="flex min-w-0 flex-col gap-3"
        data-testid="ask-try"
      >
        {/* No rule above: the label sits on the ABOUT row's line, like the form beside it. */}
        <h2 id={`${ids.text}-t`} className="depot-label flex min-h-8 items-center">
          Try asking
        </h2>
        <ExampleQuestions depotName={chosen ? chosen.name : null} onPick={fillExample} />
      </aside>
    </div>
  );
}
