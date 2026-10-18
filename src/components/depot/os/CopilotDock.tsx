'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { ArrowUpRight, Send, X } from 'lucide-react';
import { IntelligenceCore } from '@/components/ai-core/IntelligenceCore';
import { useDepotDuties } from '@/hooks/useDepotDuties';
import { requestCopilot } from '@/lib/depot/copilot/ui/copilotClient';
import { localAnswer, suggestions, type CopilotAction, type LocalAnswer } from '@/lib/depot/os/intel/copilot';
import { regionById } from '@/lib/depot/os/regions';
import { activeView } from '@/lib/depot/os/workspaces';
import { useIntel } from './IntelProvider';
import { useOsStore } from './osStore';
import { StatusTag } from './ui';

interface Turn {
  readonly id: number;
  readonly question: string;
  readonly answer: LocalAnswer | null;
  readonly engine: 'local' | 'engine' | 'pending' | 'failed';
  readonly engineLabel?: string;
}

const MAX_TURNS = 12;

function ActionButton({ action }: { readonly action: CopilotAction }) {
  const openEntity = useOsStore((s) => s.openEntity);
  const askCopilot = useOsStore((s) => s.askCopilot);
  if ('href' in action) {
    return (
      <Link href={action.href} className="os-button os-button-quiet py-1 text-[11.5px]">
        {action.label}
        <ArrowUpRight className="h-3 w-3" aria-hidden />
      </Link>
    );
  }
  const onClick = (): void => {
    if ('vehicle' in action) openEntity({ kind: 'vehicle', id: action.vehicle, depotId: action.depotId });
    else if ('depot' in action) openEntity({ kind: 'depot', id: action.depot });
    else askCopilot(action.ask);
  };
  return (
    <button type="button" onClick={onClick} className="os-button os-button-quiet py-1 text-[11.5px]">
      {action.label}
    </button>
  );
}

function AnswerCard({ turn }: { readonly turn: Turn }) {
  if (turn.engine === 'pending') {
    return <div className="font-sans text-[12.5px] text-depot-prose">Asking the AI Engine…</div>;
  }
  const a = turn.answer;
  if (!a) {
    return <p className="depot-note">The AI Engine did not answer. Try a question about a depot, a bus, shortages, fuel or maintenance.</p>;
  }
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-sans text-[13px] font-semibold leading-5 text-depot-ink">{a.headline}</h4>
        <StatusTag status={a.status} />
      </div>
      {a.paragraphs.map((p, i) => (
        <p key={i} className="depot-note">
          {p}
        </p>
      ))}
      {a.bullets.length > 0 ? (
        <ul className="space-y-1">
          {a.bullets.map((b, i) => (
            <li key={i} className="flex gap-2 font-sans text-[12.5px] leading-[18px] text-depot-prose">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-holo-glow" aria-hidden />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {a.actions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {a.actions.map((action) => (
            <ActionButton key={action.label} action={action} />
          ))}
        </div>
      ) : null}
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-depot-faint">
        {turn.engine === 'local' ? 'Answered from the records on screen' : turn.engineLabel ?? 'AI Engine'}
      </div>
    </div>
  );
}

/**
 * The persistent copilot: a right-hand column from 1280px, a drawer below it, and nothing
 * on screen while closed. It knows the scope, the region, the view and what the page has
 * in focus; its own intents answer from the same records the workspaces show, and any
 * other question goes to the AI Engine on the server.
 */
export function CopilotDock() {
  const open = useOsStore((s) => s.copilotOpen);
  const setOpen = useOsStore((s) => s.setCopilotOpen);
  const focus = useOsStore((s) => s.focus);
  const regionId = useOsStore((s) => s.regionId);
  const pendingQuestion = useOsStore((s) => s.pendingQuestion);
  const takePendingQuestion = useOsStore((s) => s.takePendingQuestion);
  const pathname = usePathname() ?? '';
  const search = useSearchParams()?.toString() ?? '';
  const intel = useIntel();
  const [turns, setTurns] = useState<readonly Turn[]>([]);
  const [draft, setDraft] = useState('');
  const nextId = useRef(1);
  const listRef = useRef<HTMLDivElement>(null);

  const duties = useDepotDuties(open ? intel.scopeDepotId : null);
  const data = useMemo(() => ({ ...intel, spareBuses: duties.data?.spareBuses ?? null }), [intel, duties.data]);
  const view = activeView(pathname, search);
  const depotName = intel.scopeDepotId ? (intel.depotsById.get(intel.scopeDepotId)?.name ?? null) : null;
  const ctx = useMemo(
    () => ({
      depotId: intel.scopeDepotId,
      regionName: intel.scopeDepotId ? null : (regionById(regionId)?.name ?? null),
      scope: intel.scope,
      focus,
      viewLabel: view?.view?.label ?? null,
    }),
    [intel.scopeDepotId, intel.scope, regionId, focus, view?.view?.label],
  );

  const ask = (question: string): void => {
    const text = question.trim();
    if (text === '') return;
    const id = nextId.current++;
    const local = localAnswer(text, data, ctx);
    if (local) {
      setTurns((held) => [...held, { id, question: text, answer: local, engine: 'local' as const }].slice(-MAX_TURNS));
      return;
    }
    setTurns((held) => [...held, { id, question: text, answer: null, engine: 'pending' as const }].slice(-MAX_TURNS));
    const scope = intel.scopeDepotId ? { kind: 'depot' as const, depotId: intel.scopeDepotId } : { kind: 'network' as const };
    void requestCopilot({ task: 'ask', question: text.slice(0, 280), scope }).then((result) => {
      const answer: LocalAnswer | null = result.ok
        ? {
            intent: 'engine',
            headline: result.response.headline,
            paragraphs: result.response.paragraphs,
            bullets: result.response.table
              ? result.response.table.rows.slice(0, 6).map((row) => row.join(' · '))
              : [],
            actions: [],
            status: 'derived',
          }
        : {
            intent: 'engine-failed',
            headline:
              result.kind === 'rate_limited'
                ? `The AI Engine is busy; ask again in ${result.retryAfterSeconds} seconds`
                : 'The AI Engine could not answer that now',
            paragraphs: ['The copilot answers questions about shortages, standby buses, breakdowns, fuel, maintenance, a bus by registration, or what happens if buses become unavailable.'],
            bullets: [],
            actions: [{ label: 'Open the AI Engine console', href: '/project/depots/ask' }],
            status: 'derived',
          };
      const engineLabel = result.ok
        ? `AI Engine · ${result.response.provider === 'claude' ? 'language model' : 'scripted writer'}`
        : 'AI Engine';
      setTurns((held) =>
        held.map((t) => (t.id === id ? { ...t, answer, engine: result.ok ? ('engine' as const) : ('failed' as const), engineLabel } : t)),
      );
    });
  };

  useEffect(() => {
    if (!open || pendingQuestion === null) return;
    const question = takePendingQuestion();
    if (question) ask(question);
    // `ask` reads the latest intel; the question is taken once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pendingQuestion]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  if (!open) return null;

  const contextLine = [
    depotName ?? (ctx.regionName ? `${ctx.regionName} region` : 'Headquarters'),
    ctx.viewLabel,
    focus ? focus.label : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <aside
      aria-label="Olympuss copilot"
      data-testid="os-copilot"
      className="fixed inset-y-0 right-0 z-[90] flex w-full flex-col border-l border-depot-line-strong bg-depot-bar sm:w-[24rem] xl:sticky xl:top-[var(--depot-bar-h)] xl:z-20 xl:h-[calc(100dvh-var(--depot-bar-h))] xl:w-[23rem] xl:shrink-0"
    >
      <header className="flex items-center gap-3 border-b border-depot-line px-4 py-3">
        <IntelligenceCore state={turns.some((t) => t.engine === 'pending') ? 'Analysing' : 'Listening'} size={34} />
        <div className="min-w-0 flex-1">
          <div className="font-display text-[11px] uppercase tracking-[0.18em] text-holo-glow">Olympuss Copilot</div>
          <div className="truncate font-sans text-[11.5px] text-depot-prose" title={contextLine}>
            {contextLine}
          </div>
        </div>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close the copilot" className="os-button os-button-quiet h-8 w-8 px-0">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </header>

      <div ref={listRef} className="os-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {turns.length === 0 ? (
          <div className="space-y-3">
            <p className="depot-note">
              Ask about the {depotName ?? 'network'} in plain words. Answers come from the records on screen and open the view behind them; nothing is dispatched without a person.
            </p>
          </div>
        ) : null}
        {turns.map((turn) => (
          <div key={turn.id} className="space-y-2">
            <div className="ml-8 rounded-md border border-holo-glow/20 bg-holo-glow/[0.06] px-3 py-2 font-sans text-[12.5px] text-depot-ink">
              {turn.question}
            </div>
            <div className="os-ai-glow rounded-md border border-holo-glow/15 p-3">
              <AnswerCard turn={turn} />
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-depot-line px-4 py-3">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {suggestions(ctx, depotName).slice(0, turns.length === 0 ? 6 : 3).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => ask(s)}
              className="rounded-full border border-holo-glow/20 px-2.5 py-1 text-left font-sans text-[11.5px] text-depot-prose hover:border-holo-glow/50 hover:text-depot-ink"
            >
              {s}
            </button>
          ))}
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            ask(draft);
            setDraft('');
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={280}
            placeholder="Ask about this view, a depot or a bus"
            aria-label="Ask the copilot"
            className="depot-field min-w-0 flex-1 font-sans text-depot-ink"
          />
          <button type="submit" className="os-button os-button-solid h-8 w-8 px-0" aria-label="Send">
            <Send className="h-3.5 w-3.5" aria-hidden />
          </button>
        </form>
      </div>
    </aside>
  );
}
