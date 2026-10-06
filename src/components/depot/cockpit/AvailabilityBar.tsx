'use client';

import Link from 'next/link';
import { useDepotDetailContext } from '@/components/depot/data/DepotDetailProvider';
import { BUS_STATE_SQUARE } from '@/components/depot/shell/BusStateMark';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { useDepotForecast } from '@/hooks/useDepotForecast';
import {
  legendWord,
  weekTrendNote,
  type AvailabilitySegment,
  type YardLine,
} from '@/lib/depot/cockpit/availability';
import { formatCount } from '@/lib/depot/format';
import { COCKPIT_TREND_METRIC } from '@/lib/depot/forecast/trendMounts';
import { METRIC_LABEL } from '@/lib/depot/forecast/wording';

export interface AvailabilityBarProps {
  readonly fleet: number;
  readonly segments: readonly AvailabilitySegment[];
  /** The bar in words: its text equivalent. */
  readonly text: string;
  readonly yard: YardLine;
  /** The yard page, linked from the yard line. */
  readonly yardHref: string;
  /** The closing disclosure's id: the no-yard line links to the rule there. */
  readonly howId: string;
}

export const NO_BUS_SENTENCE =
  'No bus is homed at this depot on this snapshot, so there is no status to show.';

/** The section's note: the on-road share's modelled week trend, as an ordinary sentence, when there is one. */
const DEFAULT_NOTE = 'Each bus in one state, from its last report';

function useWeekNote(): string {
  const { depotId } = useDepotDetailContext();
  const state = useDepotForecast({ metric: COCKPIT_TREND_METRIC, scope: { kind: 'depot', depotId } });
  const result = state.data?.trend.result;
  if (result?.status !== 'ok') return DEFAULT_NOTE;
  return weekTrendNote(METRIC_LABEL[COCKPIT_TREND_METRIC], result.summary.week.sentence);
}

function YardRow({ yard, yardHref, howId }: Pick<AvailabilityBarProps, 'yard' | 'yardHref' | 'howId'>) {
  if (yard.kind !== 'split') {
    return (
      <StatePanel
        kind="not-established"
        compact
        tone="neutral"
        sentence={yard.sentence}
        testId="depot-no-yard"
        howLink={yard.kind === 'no-yard' ? { label: 'How a yard is found', targetId: howId } : undefined}
      />
    );
  }
  return (
    <p className="depot-prose min-w-0 tabular-nums">
      {yard.text}{' '}
      <Link href={yardHref} className="depot-link whitespace-nowrap">
        Open yard ›
      </Link>
      {yard.held ? <span className="depot-note block">{yard.held}</span> : null}
    </p>
  );
}

/**
 * Every bus of the depot in one of five states, as one stacked bar (the colours from
 * the bus-state squares, a 1px gap between segments) with a five-column legend that
 * gives each state its word, count and share, so nothing rests on colour. Then one
 * line for the yard: every bus in it, the visitors and the standing split.
 */
export function AvailabilityBar({ fleet, segments, text, yard, yardHref, howId }: AvailabilityBarProps) {
  const note = useWeekNote();
  if (fleet === 0) {
    return (
      <section aria-label="Availability" data-testid="depot-status-board">
        <StatePanel kind="empty" sentence={NO_BUS_SENTENCE} />
      </section>
    );
  }
  return (
    <section aria-labelledby="depot-availability" data-testid="depot-status-board" className="min-w-0">
      <SectionLabel id="depot-availability" label="Availability" count={fleet} note={note} />
      <div role="img" aria-label={text} className="flex h-3 w-full min-w-0 gap-px overflow-hidden" data-testid="depot-availability-bar">
        {segments
          .filter((s) => s.count > 0)
          .map((s) => (
            <span key={s.state} className={`h-full ${BUS_STATE_SQUARE[s.state]}`} style={{ flexGrow: s.count, flexBasis: 0 }} />
          ))}
      </div>
      <ul className="mt-3 grid min-w-0 grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-5" aria-label="Availability legend">
        {segments.map((s) => (
          <li key={s.state} data-testid={`depot-state-${s.state}`} className="flex min-w-0 items-baseline gap-2">
            <span aria-hidden className={`inline-block h-1.5 w-1.5 shrink-0 self-center ${BUS_STATE_SQUARE[s.state]}`} />
            <span className="min-w-0 truncate text-[13px] text-depot-muted" title={s.label}>{legendWord(s.state, s.label)}</span>
            <span className="ml-auto shrink-0 font-mono text-[15px] tabular-nums text-depot-ink">{formatCount(s.count)}</span>
            <span className="w-9 shrink-0 text-right font-mono text-[11px] tabular-nums text-depot-faint">{s.shareText}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3" data-testid="depot-standing-split">
        <YardRow yard={yard} yardHref={yardHref} howId={howId} />
      </div>
    </section>
  );
}
