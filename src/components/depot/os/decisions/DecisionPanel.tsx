'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowUpRight, Bot, CheckCircle2, Clock3, ShieldCheck, XCircle } from 'lucide-react';
import type { Decision } from '@/lib/depot/os/intel/types';
import { useOsStore, useReviewFor, type ReviewAction } from '../osStore';
import { EmptyNote, SeverityChip, StatusTag } from '../ui';
import { CATEGORY_ICON, CATEGORY_LABEL } from './DecisionQueue';

const ACTIONS: readonly { action: ReviewAction; label: string; icon: typeof CheckCircle2; tone: string }[] = [
  { action: 'approved', label: 'Approve recommendation', icon: CheckCircle2, tone: 'os-button-solid' },
  { action: 'deferred', label: 'Defer', icon: Clock3, tone: 'os-button-quiet' },
  { action: 'rejected', label: 'Reject', icon: XCircle, tone: 'os-button-quiet' },
];

function Step({ n, title, children }: { readonly n: number; readonly title: string; readonly children: React.ReactNode }) {
  return (
    <section className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3">
      <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full border border-holo-glow/35 font-mono text-[10px] text-holo-glow">
        {n}
      </span>
      <div className="min-w-0">
        <h3 className="os-kicker mb-1">{title}</h3>
        {children}
      </div>
    </section>
  );
}

/**
 * One decision in its seven parts — detected, why it matters, evidence, the
 * recommendation, alternatives, impact, and what a person must approve — with the
 * review actions. A review is recorded in this browser's decision trail; it dispatches,
 * moves or charges nothing.
 */
export function DecisionPanel({ decision, compact = false }: { readonly decision: Decision | null; readonly compact?: boolean }) {
  const recordReview = useOsStore((s) => s.recordReview);
  const clearReview = useOsStore((s) => s.clearReview);
  const askCopilot = useOsStore((s) => s.askCopilot);
  const setFocus = useOsStore((s) => s.setFocus);
  const review = useReviewFor(decision?.id ?? '');
  const [note, setNote] = useState('');

  useEffect(() => {
    setNote('');
    if (decision) setFocus({ kind: 'decision', id: decision.id, label: decision.entity.label });
  }, [decision, setFocus]);

  if (!decision) return <EmptyNote>Select a decision to see its evidence, options and impact.</EmptyNote>;
  const Icon = CATEGORY_ICON[decision.category];

  return (
    <div className="space-y-4 p-4" data-testid="os-decision-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-holo-glow" aria-hidden />
            <span className="os-kicker">
              {CATEGORY_LABEL[decision.category]} · {decision.entity.label} · {decision.timing}
            </span>
          </div>
          <h2 className="mt-1 font-sans text-[17px] font-semibold leading-6 text-depot-ink">{decision.title}</h2>
        </div>
        <div className="flex items-center gap-1.5">
          <SeverityChip severity={decision.severity} />
          <StatusTag status={decision.basis} />
        </div>
      </div>

      <div className={`grid gap-4 ${compact ? '' : 'lg:grid-cols-2'}`}>
        <div className="space-y-3">
          <Step n={1} title="What was detected">
            <p className="depot-note">{decision.detected}</p>
          </Step>
          <Step n={2} title="Why it matters">
            <p className="depot-note">{decision.whyItMatters}</p>
          </Step>
          <Step n={3} title="Evidence">
            <dl className="divide-y divide-holo-glow/[0.07] rounded-[4px] border border-holo-glow/10">
              {decision.evidence.map((e) => (
                <div key={e.label} className="flex items-center justify-between gap-3 px-2.5 py-1.5">
                  <dt className="font-sans text-[12px] text-depot-prose">{e.label}</dt>
                  <dd className="flex items-center gap-2">
                    <span className="font-mono text-[12.5px] tabular-nums text-depot-ink">{e.value}</span>
                    <StatusTag status={e.status} />
                  </dd>
                </div>
              ))}
            </dl>
          </Step>
        </div>
        <div className="space-y-3">
          <Step n={4} title="Recommended action">
            <div className="os-ai-glow rounded-[4px] border border-holo-glow/30 p-3">
              <div className="font-sans text-[13.5px] font-semibold text-holo-glow">{decision.recommendation.title}</div>
              <p className="depot-note mt-1">{decision.recommendation.detail}</p>
              <p className="mt-1.5 font-sans text-[12px] text-depot-prose">
                <span className="text-depot-muted">Trade-off: </span>
                {decision.recommendation.tradeOff}
              </p>
            </div>
          </Step>
          {decision.alternatives.length > 0 ? (
            <Step n={5} title="Alternatives">
              <ul className="space-y-1.5">
                {decision.alternatives.map((a) => (
                  <li key={a.title} className="rounded-[4px] border border-holo-glow/10 px-3 py-2">
                    <div className="font-sans text-[12.5px] font-medium text-depot-ink">{a.title}</div>
                    <div className="font-sans text-[12px] text-depot-prose">
                      {a.impact} <span className="text-depot-muted">Trade-off: {a.tradeOff}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </Step>
          ) : null}
          <Step n={decision.alternatives.length > 0 ? 6 : 5} title="Expected impact">
            <p className="font-sans text-[13px] font-medium text-holo-teal">{decision.impact}</p>
          </Step>
          <Step n={decision.alternatives.length > 0 ? 7 : 6} title="Human approval">
            <p className="flex items-start gap-1.5 font-sans text-[12.5px] text-depot-prose">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-holo-glow" aria-hidden />
              {decision.approval}
            </p>
          </Step>
        </div>
      </div>

      <div className="border-t border-holo-glow/10 pt-3">
        {review ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-holo-teal/30 bg-holo-teal/[0.06] px-3 py-2">
            <span className="font-sans text-[12.5px] text-depot-ink">
              <span className="font-semibold capitalize text-holo-teal">{review.action}</span> on{' '}
              {new Date(review.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
              {review.note ? ` — “${review.note}”` : ''}
            </span>
            <button type="button" onClick={() => clearReview(decision.id)} className="os-button os-button-quiet py-1 text-[11.5px]">
              Reopen
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={200}
              placeholder="Note for the trail (optional)"
              aria-label="Review note"
              className="depot-field min-w-[12rem] flex-1 font-sans text-depot-ink"
            />
            {ACTIONS.map(({ action, label, icon: ActionIcon, tone }) => (
              <button
                key={action}
                type="button"
                onClick={() =>
                  recordReview({
                    decisionId: decision.id,
                    title: decision.title,
                    scope: decision.entity.label,
                    action,
                    note: note.trim(),
                  })
                }
                className={`os-button ${tone}`}
                data-testid={`os-review-${action}`}
              >
                <ActionIcon className="h-3.5 w-3.5" aria-hidden />
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {decision.links.map((l) => (
            <Link key={l.href} href={l.href} className="os-button os-button-quiet py-1 text-[11.5px]">
              {l.label}
              <ArrowUpRight className="h-3 w-3" aria-hidden />
            </Link>
          ))}
          <button type="button" onClick={() => askCopilot('Explain this decision')} className="os-button os-button-quiet py-1 text-[11.5px]">
            <Bot className="h-3.5 w-3.5" aria-hidden />
            Ask the copilot
          </button>
        </div>
      </div>
    </div>
  );
}
