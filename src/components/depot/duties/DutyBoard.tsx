'use client';

import { useState } from 'react';
import { Figure, FigureBand } from '@/components/depot/shell/FigureBand';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import {
  defaultBoardView,
  viewAnnouncement,
  type BoardRow,
  type BoardView,
} from '@/lib/depot/duties/dutyBoardModel';
import type { DutyFigure } from '@/lib/depot/duties/dutyPageModel';
import { DutyLegend } from './DutyLegend';
import { DutyTable } from './DutyTable';
import { DutyTimeline } from './DutyTimeline';
import { useTableFirst } from './useTableFirst';

export interface DutyBoardProps {
  readonly depotId: string;
  /** Already ordered by start (see `buildBoardRows`). */
  readonly rows: readonly BoardRow[];
  readonly feedNow: string | null;
  /** The band: duties, matched, unmatched, spare. */
  readonly figures: readonly DutyFigure[];
  /** Why duties have no bus and how eligibility was judged, each said once above the chart. */
  readonly notes: readonly string[];
}

const VIEWS: readonly { readonly id: BoardView; readonly label: string }[] = [
  { id: 'chart', label: 'Chart' },
  { id: 'table', label: 'Table' },
];

function ViewToggle({ view, onView }: {
  readonly view: BoardView;
  readonly onView: (view: BoardView) => void;
}) {
  return (
    // Sits in the section label's controls slot; the row wraps it under the label on a phone.
    <div role="group" aria-label="Show duties as" className="flex gap-1">
      {VIEWS.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={view === option.id}
          onClick={() => onView(option.id)}
          className={`rounded-[3px] border px-3 py-1 font-mono text-[11px] uppercase leading-4 tracking-[0.12em] ${
            view === option.id
              ? 'border-holo-glow text-holo-glow'
              : 'border-depot-line text-depot-muted hover:text-depot-ink'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The page's one hero: the day's duties on a timeline in a fixed-height pane, with a
 * toggle to the same rows as a table; below 640 px the table is the default view. The whole section is the modelled
 * matching beside real registrations on a MIXED page, so its label carries the MODELLED
 * tag (ruling S51); the band and the notes are its caption. Each switch is announced.
 */
export function DutyBoard({ depotId, rows, feedNow, figures, notes }: DutyBoardProps) {
  const narrow = useTableFirst();
  // Until the reader picks a view, the board follows the width: the table below 640 px.
  const [chosen, setView] = useState<BoardView | null>(null);
  const view = chosen ?? defaultBoardView(narrow);
  return (
    <section aria-labelledby="duty-board-title" data-testid="duty-board" className="min-w-0">
      <SectionLabel
        id="duty-board-title"
        label="Duty timeline"
        count={rows.length}
        tag="modelled"
        controls={<ViewToggle view={view} onView={setView} />}
      />
      <p className="sr-only" role="status" data-testid="duty-view-status">
        {viewAnnouncement(view, rows.length)}
      </p>
      <FigureBand label="Duty figures">
        {figures.map((f) => (
          <Figure key={f.label} label={f.label} value={f.value} caption={f.caption} />
        ))}
      </FigureBand>
      {notes.length === 0 ? null : (
        <div data-testid="duty-matching-notes" className="-mt-3 mb-3 max-w-[100ch] space-y-1">
          {notes.map((note) => (
            // The reason line reads in ink; the eligibility notes after it are muted.
            <p key={note} className={note.startsWith('No bus for') ? 'depot-prose' : 'depot-note'}>
              {note}
            </p>
          ))}
        </div>
      )}
      {view === 'chart' ? (
        <>
          <DutyTimeline depotId={depotId} rows={rows} feedNow={feedNow} />
          <DutyLegend feedNow={feedNow} />
        </>
      ) : (
        <DutyTable depotId={depotId} rows={rows} />
      )}
    </section>
  );
}
