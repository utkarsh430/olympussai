'use client';

import { useState } from 'react';
import { Figure, FigureBand } from '@/components/depot/shell/FigureBand';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { viewAnnouncement, type BoardRow, type BoardView } from '@/lib/depot/duties/dutyBoardModel';
import type { DutyFigure } from '@/lib/depot/duties/dutyPageModel';
import { DutyLegend } from './DutyLegend';
import { DutyTable } from './DutyTable';
import { DutyTimeline } from './DutyTimeline';

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
    // In the section label's right slot from 640px (SectionLabel has no controls slot, so
    // it is placed over the label row); on a phone it sits under the label.
    <div
      role="group"
      aria-label="Show duties as"
      className="mb-3 flex gap-1 sm:absolute sm:right-0 sm:top-3 sm:mb-0"
    >
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
 * The page's one hero: the day's duties on a timeline in a fixed-height pane, at every
 * size, with a toggle to the same rows as a table. The whole section is the modelled
 * matching beside real registrations on a MIXED page, so its label carries the MODELLED
 * tag (ruling S51); the band and the notes are its caption. Each switch is announced.
 */
export function DutyBoard({ depotId, rows, feedNow, figures, notes }: DutyBoardProps) {
  const [view, setView] = useState<BoardView>('chart');
  return (
    <section aria-labelledby="duty-board-title" data-testid="duty-board" className="min-w-0">
      <div className="relative min-w-0">
        <SectionLabel id="duty-board-title" label="Duty timeline" count={rows.length} tag="modelled" />
        <ViewToggle view={view} onView={setView} />
      </div>
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
