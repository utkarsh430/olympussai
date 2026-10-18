'use client';

import { formatCount } from '@/lib/depot/format';
import type { ServiceBandSummary } from '@/lib/depot/service/types';
import { clockOf } from '@/lib/depot/os/intel/readiness';
import { StatusTag } from '../ui';

export interface TimelineEvent {
  readonly id: string;
  /** Hour of day, fractional allowed. */
  readonly hour: number;
  /** Optional end hour for a window. */
  readonly endHour?: number;
  readonly label: string;
  readonly tone: 'crimson' | 'amber' | 'teal' | 'cyan';
  readonly decisionId?: string;
}

const TONE_BG = {
  crimson: 'bg-alert-crimson',
  amber: 'bg-alert-amber',
  teal: 'bg-holo-teal',
  cyan: 'bg-holo-glow',
} as const;

const HOURS = 24;
const TICKS = [0, 4, 6, 10, 16, 20, 24];
const pct = (hour: number): string => `${(Math.max(0, Math.min(HOURS, hour)) / HOURS) * 100}%`;

/**
 * Today on one line: the service bands with how many buses each is short across routes,
 * the feed clock's hour, and the day's operational events (the peak shortage, breakdowns
 * now, the transfer window, the workshop's inspection window) as numbered marks on the
 * track, listed beneath it. A mark tied to a decision selects it.
 */
export function ActivityTimeline({
  bands,
  currentHour,
  events,
  onSelectDecision,
}: {
  readonly bands: readonly ServiceBandSummary[] | null;
  readonly currentHour: number | null;
  readonly events: readonly TimelineEvent[];
  readonly onSelectDecision?: (id: string) => void;
}) {
  const maxShort = Math.max(1, ...(bands ?? []).map((b) => b.busesShort));
  const ordered = [...events].sort((a, b) => a.hour - b.hour);
  return (
    <div className="space-y-3 px-4 pb-4 pt-3" data-testid="os-activity-timeline">
      <div className="relative">
        <div className="relative h-[30px] rounded-[3px] bg-depot-raised">
          {(bands ?? []).map((b) => {
            const intensity = b.busesShort / maxShort;
            return (
              <div
                key={b.band}
                className="absolute inset-y-0 overflow-hidden border-x border-void/60"
                style={{ left: pct(b.fromHour), width: `calc(${pct(b.toHour + 1)} - ${pct(b.fromHour)})` }}
                title={`${b.label} ${String(b.fromHour).padStart(2, '0')}:00–${String(b.toHour + 1).padStart(2, '0')}:00: ${b.shortRoutes} routes short by ${b.busesShort} buses; ${b.overRoutes} over-served by ${b.busesOver}`}
              >
                <div className="absolute inset-0 bg-alert-crimson" style={{ opacity: 0.06 + intensity * 0.42 }} />
                <div className="relative truncate px-2 pt-[7px] font-sans text-[11px] font-medium text-depot-ink">
                  {b.label} <span className="font-mono text-depot-prose">· {formatCount(b.busesShort)} short</span>
                </div>
              </div>
            );
          })}
          {currentHour !== null ? (
            <div className="absolute -inset-y-1 w-[2px] bg-alert-amber" style={{ left: pct(currentHour + 0.5) }} title="Feed clock" />
          ) : null}
        </div>
        <div className="relative mt-1 h-5">
          {ordered.map((e, i) => (
            <div key={e.id}>
              {e.endHour !== undefined ? (
                <div
                  className={`absolute top-[3px] h-[3px] rounded-full ${TONE_BG[e.tone]} opacity-60`}
                  style={{ left: pct(e.hour), width: `calc(${pct(e.endHour)} - ${pct(e.hour)})` }}
                  aria-hidden
                />
              ) : null}
              <span
                className={`absolute top-0 flex h-[11px] w-[11px] -translate-x-1/2 items-center justify-center rounded-full ${TONE_BG[e.tone]} font-mono text-[8px] font-bold text-void`}
                style={{ left: pct(e.hour) }}
                aria-hidden
              >
                {i + 1}
              </span>
            </div>
          ))}
        </div>
        <div className="relative h-4">
          {TICKS.map((h) => (
            <span
              key={h}
              className={`absolute font-mono text-[10px] text-depot-muted ${h === 0 ? '' : h === 24 ? '-translate-x-full' : '-translate-x-1/2'}`}
              style={{ left: pct(h) }}
            >
              {String(h % 24).padStart(2, '0')}:00
            </span>
          ))}
        </div>
      </div>
      <ol className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
        {ordered.map((e, i) => {
          const body = (
            <>
              <span className={`mt-[3px] flex h-[13px] w-[13px] shrink-0 items-center justify-center rounded-full ${TONE_BG[e.tone]} font-mono text-[8.5px] font-bold text-void`}>
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="font-mono text-[11px] text-depot-muted">
                  {clockOf(e.hour * 60)}
                  {e.endHour !== undefined ? `–${clockOf(e.endHour * 60)}` : ''}
                </span>{' '}
                <span className="font-sans text-[12.5px] text-depot-ink">{e.label}</span>
              </span>
            </>
          );
          return (
            <li key={e.id}>
              {e.decisionId && onSelectDecision ? (
                <button type="button" onClick={() => onSelectDecision(e.decisionId!)} className="flex w-full items-start gap-2 rounded-[4px] px-2 py-1 text-left hover:bg-depot-raised">
                  {body}
                </button>
              ) : (
                <div className="flex items-start gap-2 px-2 py-1">{body}</div>
              )}
            </li>
          );
        })}
      </ol>
      <div className="flex items-center justify-between gap-2 border-t border-holo-glow/10 pt-2">
        <span className="font-sans text-[11.5px] text-depot-prose">
          Band shading: buses short across routes, from Hourly Demand. Amber line: the feed clock.
        </span>
        <StatusTag status="forecast" />
      </div>
    </div>
  );
}
