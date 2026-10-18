'use client';

import { formatCount } from '@/lib/depot/format';
import type { ServiceBandSummary } from '@/lib/depot/service/types';
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

const TONE_TEXT = {
  crimson: 'text-alert-crimson',
  amber: 'text-alert-amber',
  teal: 'text-holo-teal',
  cyan: 'text-holo-glow',
} as const;

const HOURS = 24;
const TICKS = [0, 4, 6, 10, 16, 20, 24];
const pct = (hour: number): string => `${(Math.max(0, Math.min(HOURS, hour)) / HOURS) * 100}%`;

/**
 * Today on one line: the service bands with how many routes and buses each is short,
 * the feed clock's hour, and the operational events that fall in the day (the peak
 * shortage, breakdowns now, the transfer window, the workshop's night intake). A marker
 * tied to a decision selects it.
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
  return (
    <div className="space-y-3 p-4" data-testid="os-activity-timeline">
      <div className="relative h-[92px] overflow-hidden">
        <div className="absolute inset-x-0 top-[34px] h-[26px] rounded-[3px] bg-depot-raised" />
        {(bands ?? []).map((b) => {
          const intensity = b.busesShort / maxShort;
          return (
            <div
              key={b.band}
              className="absolute top-[34px] h-[26px] overflow-hidden rounded-[3px] border border-holo-glow/15"
              style={{ left: pct(b.fromHour), width: `calc(${pct(b.toHour + 1)} - ${pct(b.fromHour)})` }}
              title={`${b.label}: ${b.shortRoutes} routes short by ${b.busesShort} buses; ${b.overRoutes} over-served by ${b.busesOver}`}
            >
              <div className="absolute inset-0 bg-alert-crimson" style={{ opacity: 0.08 + intensity * 0.45 }} />
              <div className="relative truncate px-1.5 pt-[5px] font-sans text-[10.5px] font-medium text-depot-ink">
                {b.label} · <span className="font-mono">{formatCount(b.busesShort)}</span> short
              </div>
            </div>
          );
        })}
        {events.map((e, i) => {
          const top = i % 2 === 0 ? 0 : 66;
          const clickable = Boolean(e.decisionId && onSelectDecision);
          const body = (
            <>
              <span className={`h-2 w-2 shrink-0 rounded-full ${TONE_BG[e.tone]}`} aria-hidden />
              <span className={`truncate font-sans text-[10.5px] ${TONE_TEXT[e.tone]}`}>{e.label}</span>
            </>
          );
          return (
            <div
              key={e.id}
              className="absolute"
              style={e.hour > 14 ? { right: `calc(100% - ${pct(e.hour)})`, top, maxWidth: '45%' } : { left: pct(e.hour), top, maxWidth: '45%' }}
            >
              {clickable ? (
                <button type="button" onClick={() => onSelectDecision?.(e.decisionId!)} className="flex max-w-full items-center gap-1 rounded-[3px] px-1 py-0.5 hover:bg-depot-raised">
                  {body}
                </button>
              ) : (
                <div className="flex max-w-full items-center gap-1 px-1 py-0.5">{body}</div>
              )}
            </div>
          );
        })}
        {events
          .filter((e) => e.endHour !== undefined)
          .map((e) => (
            <div
              key={`${e.id}-window`}
              className={`absolute top-[62px] h-[3px] rounded-full ${TONE_BG[e.tone]} opacity-60`}
              style={{ left: pct(e.hour), width: `calc(${pct(e.endHour!)} - ${pct(e.hour)})` }}
              aria-hidden
            />
          ))}
        {currentHour !== null ? (
          <div className="absolute top-[26px] h-[42px] w-[2px] bg-alert-amber" style={{ left: pct(currentHour) }} title="Feed clock">
            <span className="absolute -top-0.5 left-1 font-mono text-[9.5px] uppercase tracking-[0.1em] text-alert-amber">Now</span>
          </div>
        ) : null}
      </div>
      <div className="relative h-4">
        {TICKS.map((h) => (
          <span key={h} className="absolute -translate-x-1/2 font-mono text-[10px] text-depot-muted" style={{ left: pct(h) }}>
            {String(h % 24).padStart(2, '0')}:00
          </span>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="font-sans text-[11.5px] text-depot-prose">Route gaps per band from Hourly Demand; markers from the decision queue.</span>
        <StatusTag status="forecast" />
      </div>
    </div>
  );
}
