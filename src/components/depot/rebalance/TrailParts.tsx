'use client';

import { useState } from 'react';
import { formatInstantIst } from '@/lib/depot/format';
import { TRAIL_CLEAR_CONFIRM } from '@/lib/depot/rebalance/decisionWording';

/*
 * The pieces every decision trail draws, whatever its subject: the clear control with its
 * confirm step, the notes about what is not listed, and one line of the list.
 */

/** "Clear trail", then a confirm step: clearing removes every entry and cannot be undone. */
export function ClearControl({ onClear }: { readonly onClear: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button type="button" className="depot-link mt-2 text-[11px]" onClick={() => setConfirming(true)}>
        Clear trail
      </button>
    );
  }
  return (
    <div role="group" aria-label="Clear the decision trail" className="mt-2 flex flex-wrap items-center gap-3">
      <span className="depot-prose text-[13px]">{TRAIL_CLEAR_CONFIRM}</span>
      <button
        type="button"
        className="depot-filter-button"
        onClick={() => {
          setConfirming(false);
          onClear();
        }}
      >
        Clear the trail
      </button>
      <button type="button" className="depot-filter-button" onClick={() => setConfirming(false)}>
        Keep it
      </button>
    </div>
  );
}

export interface TrailStateNotesProps {
  /** Said once the storage cap has dropped older decisions; null until then. */
  readonly capacityNote: string | null;
  /** What of the stored record is not listed (damaged or skipped entries); null when all is. */
  readonly stateNote: string | null;
  /** The state note's test id, so each trail keeps its own. */
  readonly stateTestId: string;
}

/** The amber notes under a trail's heading: the cap, and what could not be read. */
export function TrailStateNotes({ capacityNote, stateNote, stateTestId }: TrailStateNotesProps) {
  return (
    <>
      {capacityNote ? <p className="depot-note mt-2 text-alert-amber">{capacityNote}</p> : null}
      {stateNote ? (
        <p className="depot-note mt-2 text-alert-amber" data-testid={stateTestId}>
          {stateNote}
        </p>
      ) : null}
    </>
  );
}

export interface TrailLineProps {
  readonly at: string;
  /** What was decided, with its marks ("(later undone)"). */
  readonly line: string;
  /** A second line under it (the what-if it was decided on), or null. */
  readonly context: string | null;
  readonly note: string;
  /** Withdraws this decision; null when it is not the one in force. */
  readonly onUndo: (() => void) | null;
}

/** One entry of a trail's list: when, what, the note, and Undo for the decision in force. */
export function TrailLine({ at, line, context, note, onUndo }: TrailLineProps) {
  return (
    <li className="flex min-w-0 flex-wrap items-baseline gap-x-3 px-3 py-2">
      <span className="text-[11px] text-depot-faint">{formatInstantIst(at)}</span>
      <span className="min-w-0 flex-1 text-[13px] text-depot-ink">
        {line}
        {context ? <span className="block text-[11px] text-depot-muted">{context}</span> : null}
        {note ? <span className="block font-sans text-xs text-depot-prose">Note: {note}</span> : null}
      </span>
      {onUndo ? (
        <button type="button" className="depot-link text-[11px]" onClick={onUndo}>
          Undo
        </button>
      ) : null}
    </li>
  );
}

/** The bordered, divided list a trail's lines sit in. */
export const TRAIL_LIST_CLASS = 'flex flex-col divide-y divide-depot-line rounded-md border border-depot-line';
