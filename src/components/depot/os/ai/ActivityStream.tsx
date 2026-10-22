'use client';

import Link from 'next/link';
import type { ActivityEvent } from './aiStore';
import { AiGlyph } from '../aiKinds';
import { StatusTag } from '../ui';

export function streamTime(at: number): string {
  return new Date(at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

const SEVERITY_EDGE = { critical: 'border-l-alert-crimson', high: 'border-l-alert-amber', medium: 'border-l-holo-glow/50', low: 'border-l-depot-line' } as const;

/**
 * The AI activity stream: one line per thing an analysis cycle found or changed, newest
 * first, each with the browser time the cycle ran, the kind of AI work, what the figure
 * rests on, and a link to the records behind it.
 */
export function ActivityStream({
  events,
  compact = false,
  emptyText = 'The first analysis cycle runs as soon as the network snapshot is in.',
  onNavigate,
}: {
  readonly events: readonly ActivityEvent[];
  readonly compact?: boolean;
  readonly emptyText?: string;
  readonly onNavigate?: () => void;
}) {
  if (events.length === 0) return <p className="px-4 py-5 font-sans text-[12.5px] text-depot-prose">{emptyText}</p>;
  return (
    <ol className="divide-y divide-holo-glow/[0.06]" data-testid="os-activity-stream">
      {events.map((e) => {
        const body = (
          <>
            <span className="w-[58px] shrink-0 pt-px font-mono text-[11px] tabular-nums text-depot-muted">{streamTime(e.at)}</span>
            <span className="pt-[3px]">
              <AiGlyph kind={e.kind} className="h-3.5 w-3.5" />
            </span>
            <span className={`min-w-0 flex-1 font-sans ${compact ? 'text-[12px] leading-[17px]' : 'text-[12.5px] leading-[18px]'} text-depot-ink`}>{e.text}</span>
            <span className="shrink-0 pt-px">
              <StatusTag status={e.status} />
            </span>
          </>
        );
        const edge = e.severity ? SEVERITY_EDGE[e.severity] : 'border-l-transparent';
        return (
          <li key={e.id} className={`os-stream-in border-l-2 ${edge}`}>
            {e.href ? (
              <Link href={e.href} onClick={onNavigate} className={`flex items-start gap-2.5 px-3 ${compact ? 'py-1.5' : 'py-2'} transition-colors hover:bg-depot-raised`}>
                {body}
              </Link>
            ) : (
              <div className={`flex items-start gap-2.5 px-3 ${compact ? 'py-1.5' : 'py-2'}`}>{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
