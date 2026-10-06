'use client';

import { BUS_STATE_SQUARE } from '@/components/depot/shell/BusStateMark';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { CockpitWeekTrend } from '@/components/depot/trends/WeekTrend';
import type { AvailabilitySegment, StandingLine } from '@/lib/depot/cockpit/availability';
import { formatCount } from '@/lib/depot/format';

export interface AvailabilityBarProps {
  readonly fleet: number;
  readonly segments: readonly AvailabilitySegment[];
  /** The bar in words: its text equivalent. */
  readonly text: string;
  readonly standing: StandingLine;
}

export const NO_BUS_SENTENCE =
  'No bus is homed at this depot on this snapshot, so there is no status to show.';

/**
 * Every bus of the depot in one of five states, as one stacked bar (the colours from
 * the bus-state squares, a 1px gap between segments) with a legend that gives each
 * state its word, count and share, so nothing rests on colour. The standing buses'
 * places follow on one line, or the yard rule when no yard is established.
 */
export function AvailabilityBar({ fleet, segments, text, standing }: AvailabilityBarProps) {
  if (fleet === 0) {
    return (
      <section aria-label="Availability" data-testid="depot-status-board">
        <StatePanel kind="empty" sentence={NO_BUS_SENTENCE} />
      </section>
    );
  }
  return (
    <section aria-labelledby="depot-availability" data-testid="depot-status-board" className="min-w-0">
      <SectionLabel id="depot-availability" label="Availability" count={fleet} note="Each bus in one state, from its last report" />
      <div role="img" aria-label={text} className="flex h-3 w-full min-w-0 gap-px overflow-hidden" data-testid="depot-availability-bar">
        {segments
          .filter((s) => s.count > 0)
          .map((s) => (
            <span key={s.state} className={`h-full ${BUS_STATE_SQUARE[s.state]}`} style={{ flexGrow: s.count, flexBasis: 0 }} />
          ))}
      </div>
      <ul className="mt-3 flex min-w-0 flex-wrap gap-x-6 gap-y-2" aria-label="Availability legend">
        {segments.map((s) => (
          <li key={s.state} data-testid={`depot-state-${s.state}`} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <span aria-hidden className={`inline-block h-1.5 w-1.5 shrink-0 self-center ${BUS_STATE_SQUARE[s.state]}`} />
            <span className="text-[13px] text-depot-muted">{s.label}</span>
            <span className="font-mono text-[15px] tabular-nums text-depot-ink">{formatCount(s.count)}</span>
            <span className="font-mono text-[11px] tabular-nums text-depot-faint">{s.shareText}</span>
            {s.state === 'on_road' ? <CockpitWeekTrend /> : null}
          </li>
        ))}
      </ul>
      <div className="mt-3" data-testid="depot-standing-split">
        {standing.kind === 'no-yard' ? (
          <StatePanel kind="not-established" sentence={standing.sentence} testId="depot-no-yard" />
        ) : (
          <p className="min-w-0 font-mono text-[13px] tabular-nums text-depot-ink">
            {standing.text}
            {standing.held ? <span className="block font-sans text-xs text-depot-muted">{standing.held}</span> : null}
          </p>
        )}
      </div>
    </section>
  );
}
