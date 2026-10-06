'use client';

import { useState } from 'react';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { viewAnnouncement, type BoardRow, type BoardView } from '@/lib/depot/duties/dutyBoardModel';
import { DutyLegend } from './DutyLegend';
import { DutyTable } from './DutyTable';
import { DutyTimeline } from './DutyTimeline';

export interface DutyBoardProps {
  readonly depotId: string;
  /** Already ordered by start (see `buildBoardRows`). */
  readonly rows: readonly BoardRow[];
  readonly feedNow: string | null;
  /** The reason unmatched duties have no bus, stated once above the chart. */
  readonly unmatched: string | null;
}

const VIEWS: readonly { readonly id: BoardView; readonly label: string }[] = [
  { id: 'chart', label: 'Chart' },
  { id: 'table', label: 'Table' },
];

/**
 * The page's one hero: the day's duties on a timeline in a fixed-height pane, at
 * every size and every number of duties, with a toggle to the same rows as a table.
 * Each switch is announced.
 */
export function DutyBoard({ depotId, rows, feedNow, unmatched }: DutyBoardProps) {
  const [view, setView] = useState<BoardView>('chart');
  return (
    <section aria-labelledby="duty-board-title" data-testid="duty-board" className="min-w-0">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <SectionLabel
            id="duty-board-title"
            label="Duty timeline, 04:00 to 24:00"
            count={rows.length}
          />
        </div>
        <div role="group" aria-label="Show duties as" className="mb-2 flex gap-1">
          {VIEWS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={view === option.id}
              onClick={() => setView(option.id)}
              className={`rounded-[3px] border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.12em] ${
                view === option.id
                  ? 'border-holo-glow text-holo-glow'
                  : 'border-depot-line text-depot-muted hover:text-depot-ink'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <p className="sr-only" role="status" data-testid="duty-view-status">
        {viewAnnouncement(view, rows.length)}
      </p>
      {unmatched === null ? null : (
        <p className="mb-2 text-[13px] text-depot-ink" data-testid="duty-unmatched-line">
          {unmatched}
        </p>
      )}
      {view === 'chart' ? (
        <>
          <DutyTimeline depotId={depotId} rows={rows} feedNow={feedNow} />
          <DutyLegend />
        </>
      ) : (
        <DutyTable depotId={depotId} rows={rows} />
      )}
    </section>
  );
}
