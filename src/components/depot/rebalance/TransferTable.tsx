'use client';

import { useState } from 'react';
import { NOTE_MAX_CHARS, validateNote } from '@/lib/depot/decisions';
import { formatCount } from '@/lib/depot/format';
import type { TransferDecisionKind } from '@/lib/depot/rebalance/rebalanceModel';
import type { TransferRow } from '@/lib/depot/rebalance/transferModel';

export interface TransferTableProps {
  readonly rows: readonly TransferRow[];
  readonly selectedId: string | null;
  readonly onSelect: (transferId: string | null) => void;
  /** Records a decision; it changes nothing but the record. */
  readonly onDecide: (row: TransferRow, decision: TransferDecisionKind, note: string) => void;
}

const DECISIONS: readonly { readonly kind: TransferDecisionKind; readonly label: string }[] = [
  { kind: 'approved', label: 'Approve' },
  { kind: 'rejected', label: 'Reject' },
  { kind: 'deferred', label: 'Defer' },
];

const DECISION_WORD: Readonly<Record<TransferDecisionKind, string>> = {
  approved: 'Approved',
  rejected: 'Rejected',
  deferred: 'Deferred',
};

const HEADERS = [
  'Transfer',
  'Buses',
  'Road km',
  'Bus-km',
  'Giver spare before',
  'Receiver short before',
  'Decision',
  'Record a decision',
] as const;

/**
 * Recommended transfers with the context a planner decides on. Selecting a
 * row highlights its arc and depots on the map. Approve, Reject and Defer
 * only add to the local record; no transfer order is issued.
 */
export function TransferTable({ rows, selectedId, onSelect, onDecide }: TransferTableProps) {
  const [notes, setNotes] = useState<Readonly<Record<string, string>>>({});
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});

  function decide(row: TransferRow, kind: TransferDecisionKind): void {
    const result = validateNote(notes[row.id] ?? '');
    if (!result.ok) {
      setErrors({ ...errors, [row.id]: result.error });
      return;
    }
    onDecide(row, kind, result.value);
    setNotes({ ...notes, [row.id]: '' });
    setErrors({ ...errors, [row.id]: '' });
  }

  return (
    <div
      role="region"
      aria-label="Recommended transfers"
      tabIndex={0}
      className="depot-table-frame"
      data-testid="rebalance-transfers"
    >
      <table className="depot-table">
        <caption className="sr-only">Recommended transfers between depots, largest first</caption>
        <thead>
          <tr>
            {HEADERS.map((h, i) => (
              <th key={h} scope="col" className={i > 0 && i < 6 ? 'depot-align-right' : undefined}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const selected = row.id === selectedId;
            const noteId = `transfer-note-${row.id}`;
            return (
              <tr key={row.id} className={selected ? 'depot-row-selected' : undefined}>
                <td>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onSelect(selected ? null : row.id)}
                    className="depot-link max-w-[260px] truncate text-left"
                    title={`${row.fromName} to ${row.toName}`}
                  >
                    {row.fromName} → {row.toName}
                  </button>
                </td>
                <td className="depot-align-right">{formatCount(row.buses)}</td>
                <td className="depot-align-right">{row.distanceKm.toFixed(1)}</td>
                <td className="depot-align-right">{row.busKm.toFixed(1)}</td>
                <td className="depot-align-right">{formatCount(row.giverSurplusBefore)}</td>
                <td className="depot-align-right">{formatCount(row.receiverDeficitBefore)}</td>
                <td>{row.decision ? DECISION_WORD[row.decision] : 'None yet'}</td>
                <td>
                  <div className="flex flex-wrap items-center gap-2">
                    <label htmlFor={noteId} className="sr-only">
                      Note for {row.fromName} to {row.toName}, optional, up to {NOTE_MAX_CHARS}{' '}
                      characters
                    </label>
                    <input
                      id={noteId}
                      type="text"
                      maxLength={NOTE_MAX_CHARS}
                      placeholder="Note (optional)"
                      value={notes[row.id] ?? ''}
                      onChange={(e) => setNotes({ ...notes, [row.id]: e.target.value })}
                      className="depot-field w-40"
                    />
                    {DECISIONS.map((d) => (
                      <button
                        key={d.kind}
                        type="button"
                        aria-pressed={row.decision === d.kind}
                        onClick={() => decide(row, d.kind)}
                        className="depot-filter-button"
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                  {errors[row.id] ? (
                    <p role="alert" className="mt-1 text-[11px] text-alert-amber">
                      {errors[row.id]}
                    </p>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
