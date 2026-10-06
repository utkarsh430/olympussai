'use client';

import { useState } from 'react';
import { NOTE_MAX_CHARS, validateNote } from '@/lib/depot/rebalance/decisionEvents';
import { isDecisionCurrent } from '@/lib/depot/rebalance/decisionWording';
import type { TransferDecisionKind } from '@/lib/depot/rebalance/rebalanceModel';
import type { TransferRow } from '@/lib/depot/rebalance/transferModel';

const DECISIONS: readonly { readonly kind: TransferDecisionKind; readonly label: string }[] = [
  { kind: 'approved', label: 'Approve' },
  { kind: 'rejected', label: 'Reject' },
  { kind: 'deferred', label: 'Defer' },
];

export interface TransferDecisionControlsProps {
  readonly row: TransferRow;
  /** The decision in force, in words ("Approved for 5 buses", "None yet"). */
  readonly status: string;
  /** Records a decision; it changes nothing but the record. */
  readonly onDecide: (row: TransferRow, decision: TransferDecisionKind, note: string) => void;
  /** Withdraws the decision in force; null when there is none to undo. */
  readonly onUndo: (() => void) | null;
}

/**
 * The decision in force, an optional note, Approve, Reject and Defer as toggles (pressed for
 * the decision recorded for the count shown) and Undo, in one block of the transfer's
 * expanded row, with its rationale and figures. Each only adds to the local record.
 */
export function TransferDecisionControls({
  row,
  status,
  onDecide,
  onUndo,
}: TransferDecisionControlsProps) {
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const noteId = `transfer-note-${row.id}`;

  function decide(kind: TransferDecisionKind): void {
    const result = validateNote(note);
    if (!result.ok) return setError(result.error);
    onDecide(row, kind, result.value);
    setNote('');
    setError('');
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-testid="transfer-decision">
      <p className="depot-prose text-[13px]">
        <span className="depot-label mr-2">Decision</span>
        {status}
      </p>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <label htmlFor={noteId} className="sr-only">
          Note for {row.fromName} to {row.toName}, optional, up to {NOTE_MAX_CHARS} characters
        </label>
        <input
          id={noteId}
          type="text"
          maxLength={NOTE_MAX_CHARS}
          placeholder="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="depot-field w-48 max-w-full py-0.5"
        />
        {DECISIONS.map((d) => (
          <button
            key={d.kind}
            type="button"
            aria-pressed={isDecisionCurrent(row.decision, d.kind, row.buses)}
            onClick={() => decide(d.kind)}
            className="depot-filter-button shrink-0"
          >
            {d.label}
          </button>
        ))}
        {onUndo ? (
          <button type="button" onClick={onUndo} className="depot-filter-button shrink-0">
            Undo
          </button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="depot-note text-alert-amber">
          {error}
        </p>
      ) : null}
    </div>
  );
}
