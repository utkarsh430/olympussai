'use client';

import { useState } from 'react';
import type { BoardRow } from '@/lib/depot/duties/dutyBoardModel';
import { DutyLegend } from './DutyLegend';
import { DutyTable } from './DutyTable';
import { DutyTimeline } from './DutyTimeline';

export interface DutyBoardProps {
  readonly depotId: string;
  /** Already ordered by start (see `buildBoardRows`). */
  readonly rows: readonly BoardRow[];
  readonly feedNow: string | null;
}

type View = 'chart' | 'table';

const VIEWS: readonly { readonly id: View; readonly label: string }[] = [
  { id: 'chart', label: 'Chart' },
  { id: 'table', label: 'Table' },
];

/**
 * The page's one hero: the day's modelled duties on a timeline, with a toggle to
 * the same rows as a table. The chart is the default; the table is the text
 * equivalent for keyboard and screen-reader users.
 */
export function DutyBoard({ depotId, rows, feedNow }: DutyBoardProps) {
  const [view, setView] = useState<View>('chart');
  return (
    <section aria-labelledby="duty-board-title" data-testid="duty-board">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="duty-board-title" className="depot-label">
          Duty timeline, 04:00 to 24:00 (MODELLED)
        </h2>
        <div role="group" aria-label="Show duties as" className="flex gap-1">
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
