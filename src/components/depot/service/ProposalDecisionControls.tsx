'use client';

import { useId, useState } from 'react';
import { NOTE_MAX_CHARS, validateNote } from '@/lib/depot/rebalance/decisionEvents';
import type { ProposalDecisionEntry } from '@/lib/depot/rebalance/proposalDecisionEvents';
import {
  PROPOSAL_DECISION_NOTE,
  isProposalDecisionCurrent,
  proposalStatusText,
} from '@/lib/depot/rebalance/proposalDecisionWording';
import type { TransferDecisionKind } from '@/lib/depot/rebalance/rebalanceModel';
import type { Proposal } from '@/lib/depot/service/types';

const DECISIONS: readonly { readonly kind: TransferDecisionKind; readonly label: string }[] = [
  { kind: 'approved', label: 'Approve' },
  { kind: 'deferred', label: 'Defer' },
  { kind: 'rejected', label: 'Reject' },
];

export interface ProposalDecisionControlsProps {
  readonly proposal: Proposal;
  /** What the proposal is, for the note's label and the group's name: "07:00–11:00 Add 3". */
  readonly label: string;
  /** The decision in force on this proposal, or null. */
  readonly decision: ProposalDecisionEntry | null;
  /** Records a decision; it changes nothing but the record. */
  readonly onDecide: (proposal: Proposal, kind: TransferDecisionKind, note: string) => void;
  /** Withdraws the decision in force; null when there is none to undo. */
  readonly onUndo: (() => void) | null;
}

/**
 * The decision in force, an optional note, Approve, Defer and Reject as toggles (pressed for
 * the decision recorded for the change shown) and Undo, in one block of the proposal's
 * opened row. Each only adds to the record kept in this browser; nothing is dispatched.
 */
export function ProposalDecisionControls({
  proposal,
  label,
  decision,
  onDecide,
  onUndo,
}: ProposalDecisionControlsProps) {
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const noteId = useId();

  function decide(kind: TransferDecisionKind): void {
    const result = validateNote(note);
    if (!result.ok) return setError(result.error);
    onDecide(proposal, kind, result.value);
    setNote('');
    setError('');
  }

  return (
    <div
      role="group"
      aria-label={`Decision on ${label}`}
      className="flex min-w-0 flex-col gap-1.5 print:hidden"
      data-testid="proposal-decision"
    >
      <p className="depot-prose text-[13px]">
        <span className="depot-label mr-2">Decision</span>
        {proposalStatusText(decision, proposal.change)}
      </p>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <label htmlFor={noteId} className="sr-only">
          Note for {label}, optional, up to {NOTE_MAX_CHARS} characters
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
            aria-pressed={isProposalDecisionCurrent(decision, d.kind, proposal.change)}
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
      <p className="depot-note">{PROPOSAL_DECISION_NOTE}</p>
      {error ? (
        <p role="alert" className="depot-note text-alert-amber">
          {error}
        </p>
      ) : null}
    </div>
  );
}
