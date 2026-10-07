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

/** What the console answers about, shown while nothing has been asked. */
const CAPABILITIES: readonly { readonly label: string; readonly text: string }[] = [
  { label: 'Network', text: 'Rankings, a summary, depots short of buses or with spare ones.' },
  { label: 'One depot', text: 'Its summary, exceptions, transfers, outshedding; choose it under About.' },
  { label: 'Service by the hour', text: "Today's plan, routes over-served by band, why a route is short at an hour." },
];

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
  const empty = history.length === 0 && !(loading && pending);

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
  const lampState = loading ? 'Writing' : cooling ? 'Cooling down' : 'Standing by';

  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start">
      {/* The console: a HUD frame holding the composer, then the answers newest first. */}
      <section
        aria-labelledby={`${ids.text}-h`}
        className="hud-panel-strong hud-corners flex min-w-0 flex-col"
        data-testid="ask-console"
      >
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-depot-line px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span aria-hidden className="depot-lamp" />
            <h2 id={`${ids.text}-h`} className="depot-eyebrow mb-0">
              Copilot console
            </h2>
            <span className="truncate font-mono text-[11px] uppercase tracking-[0.12em] text-depot-muted" data-testid="ask-lamp">
              {lampState}
            </span>
          </div>
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
        </div>

        <form
          className="flex min-w-0 flex-col gap-2 border-b border-depot-line px-4 py-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {mismatch ? (
            <p className="depot-note min-w-0" data-testid="ask-scope-mismatch">
              {mismatch}
            </p>
          ) : null}
          <label htmlFor={ids.text} className="depot-label">
            Your question
          </label>
          <div className="relative min-w-0">
            <textarea
              ref={textRef}
              id={ids.text}
              rows={3}
              value={text}
              aria-describedby={ids.help}
              placeholder={`Ask about ${scopeLabel === 'Whole network' ? 'the network' : scopeLabel}, a route or an hour of the day…`}
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
              className="depot-field min-h-[96px] w-full resize-y font-sans text-sm placeholder:text-depot-faint sm:pr-32"
            />
            <button
              type="submit"
              disabled={loading || cooling}
              className="hud-button-primary mt-2 w-full sm:absolute sm:bottom-2 sm:right-2 sm:mt-0 sm:w-auto"
            >
              Submit
            </button>
          </div>
          <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p id={ids.help} className="depot-note min-w-0">
              <span className={remaining < 0 ? 'text-alert-crimson' : undefined}>
                {limitSentence(remaining)}
              </span>
              {' · Enter to send, Shift+Enter for a new line.'}
            </p>
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
              <p role="status" className="depot-note min-w-0">
                {status}
              </p>
              {countdown ? (
                <p data-testid="ask-countdown" className="depot-note min-w-0">
                  {countdown}
                </p>
              ) : null}
            </div>
          </div>
        </form>

        {empty ? (
          <div
            className="depot-console-glow flex min-h-[320px] min-w-0 flex-1 flex-col items-center justify-center gap-5 px-4 py-10 text-center xl:min-h-[420px]"
            data-testid="ask-empty"
          >
            <p className="sr-only">No questions asked yet.</p>
            <span aria-hidden className="depot-eyebrow mb-0 text-holo-glow">
              Ready
            </span>
            <p className="depot-prose max-w-[56ch]">
              Ask where buses are short or spare, which routes need more or fewer in an hour, or where to start.
              Pick a suggested question or type your own; every answer says what it rests on, and nothing is stored.
            </p>
            <ul className="grid w-full max-w-3xl min-w-0 gap-3 text-left sm:grid-cols-3" aria-label="What can be asked">
              {CAPABILITIES.map((item) => (
                <li key={item.label} className="depot-panel min-w-0 px-3 py-2.5">
                  <span className="depot-eyebrow">{item.label}</span>
                  <p className="depot-note">{item.text}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <section aria-labelledby={`${ids.text}-a`} className="flex min-w-0 flex-col gap-3 px-4 py-4">
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
      </section>

      {/* The suggested questions beside the console from 1280px; below it on narrower screens. */}
      <aside
        aria-labelledby={`${ids.text}-t`}
        className="hud-panel hud-corners flex min-w-0 flex-col gap-3 py-3"
        data-testid="ask-try"
      >
        <div className="flex min-w-0 items-baseline justify-between gap-3 border-b border-depot-line px-4 pb-3">
          <h2 id={`${ids.text}-t`} className="depot-eyebrow mb-0">
            Suggested questions
          </h2>
          <span className="shrink-0 font-mono text-[11px] text-depot-muted">A press fills the box</span>
        </div>
        <div className="min-w-0 px-1">
          <ExampleQuestions depotName={chosen ? chosen.name : null} onPick={fillExample} />
        </div>
      </aside>
    </div>
  );
}
