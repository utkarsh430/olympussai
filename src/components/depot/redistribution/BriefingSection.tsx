'use client';

import { ClipboardCopy, FileText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { briefingText, buildBriefing, type BriefingSection as Section } from '@/lib/depot/redistribution/briefing';
import type { EngineModel } from '@/lib/depot/redistribution/engineModel';
import type { EngineState } from '@/lib/depot/redistribution/engineState';
import { PAGE_TITLE, SECTION } from '@/lib/depot/redistribution/wording';

export interface BriefingSectionProps {
  readonly model: EngineModel;
  readonly state: EngineState;
}

const COPIED_MS = 2000;

/** What the briefing was written from; when it changes, the briefing is out of date. */
function stateKey(model: EngineModel, state: EngineState): string {
  return [state.depotId ?? 'all', state.fromHour, state.toHour, state.planStatus, [...model.includedIds].sort().join(',')].join('|');
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** The AI operational briefing, written on demand from the page's state, with a copy action. */
export function BriefingSection({ model, state }: BriefingSectionProps) {
  const [written, setWritten] = useState<{ readonly key: string; readonly sections: readonly Section[] } | null>(null);
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  const key = stateKey(model, state);
  const stale = written !== null && written.key !== key;

  useEffect(() => {
    if (copied === 'idle') return undefined;
    const timer = setTimeout(() => setCopied('idle'), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const generate = (): void => {
    const ready = state.planStatus === 'ready';
    setWritten({
      key,
      sections: buildBriefing({
        scenario: model.scenario,
        selection: model.selection,
        bandLabel: model.bandLabel,
        routes: model.routes,
        before: model.before,
        after: ready ? model.after : null,
        recommendations: model.plan.recommendations,
        includedIds: model.includedIds,
        unresolved: model.unresolvedAfter,
      }),
    });
  };

  return (
    <section aria-labelledby={SECTION.briefing.id} className="min-w-0" data-testid="operational-briefing">
      <SectionLabel
        id={SECTION.briefing.id}
        label={SECTION.briefing.label}
        note="Written from the figures on this page; advisory, it describes and does not instruct"
        controls={
          written ? (
            <button
              type="button"
              className="depot-filter-button inline-flex items-center gap-1"
              onClick={() => {
                void copyText(briefingText(PAGE_TITLE, written.sections)).then((ok) => setCopied(ok ? 'done' : 'failed'));
              }}
            >
              <ClipboardCopy aria-hidden className="h-3 w-3" />
              {copied === 'done' ? 'Copied' : copied === 'failed' ? 'Copy unavailable' : 'Copy Briefing'}
            </button>
          ) : undefined
        }
      />
      {written === null ? (
        <div className="depot-panel flex flex-col items-start gap-4 px-5 py-6 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="depot-prose">Six sections: the network situation, the critical shortages, the surplus available, the recommended movements, the expected impact and what still needs the manager&rsquo;s attention.</p>
            <p className="depot-note mt-1">{state.planStatus === 'ready' ? 'The briefing reflects the transfers kept above.' : 'Generate a plan first to include recommended movements and projected impact.'}</p>
          </div>
          <button type="button" className="depot-button-primary inline-flex shrink-0 items-center gap-2 px-5 py-2.5 text-[12px]" onClick={generate} data-testid="generate-briefing">
            <FileText aria-hidden className="h-4 w-4" />
            Generate AI Service Briefing
          </button>
        </div>
      ) : (
        <div className="depot-panel px-5 py-5" data-testid="briefing-body">
          {stale ? (
            <div className="mb-4 flex flex-wrap items-center gap-3 border-l-2 border-l-alert-amber bg-depot-surface px-3 py-2">
              <p className="depot-note min-w-0 flex-1">The selection or the kept transfers have changed since this briefing was written.</p>
              <button type="button" className="depot-filter-button" onClick={generate}>
                Rewrite briefing
              </button>
            </div>
          ) : null}
          <div className="grid gap-5 lg:grid-cols-2">
            {written.sections.map((s) => (
              <article key={s.heading} className="min-w-0">
                <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-holo-glow">{s.heading}</h3>
                <div className="mt-2 space-y-1.5">
                  {s.paragraphs.map((p) => (
                    <p key={p} className="depot-prose">
                      {p}
                    </p>
                  ))}
                </div>
              </article>
            ))}
          </div>
          {!stale ? (
            <div className="mt-5 border-t border-depot-line pt-3">
              <button type="button" className="depot-filter-button" onClick={generate}>
                Rewrite briefing
              </button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
