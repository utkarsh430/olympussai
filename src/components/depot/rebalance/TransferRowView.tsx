'use client';

import { useState, type ReactNode } from 'react';
import {
  RationalePanel,
  RationaleToggle,
  useRationale,
} from '@/components/depot/copilot/RationaleButton';
import { formatCount } from '@/lib/depot/format';
import { samePlaceNote } from '@/lib/depot/rebalance/pageLayout';
import { NOTE_MAX_CHARS, validateNote } from '@/lib/depot/rebalance/decisionEvents';
import { decisionStatusText, isDecisionCurrent } from '@/lib/depot/rebalance/decisionWording';
import type { TransferDecisionKind } from '@/lib/depot/rebalance/rebalanceModel';
import type { TransferRow } from '@/lib/depot/rebalance/transferModel';

const DECISIONS: readonly { readonly kind: TransferDecisionKind; readonly label: string }[] = [
  { kind: 'approved', label: 'Approve' },
  { kind: 'rejected', label: 'Reject' },
  { kind: 'deferred', label: 'Defer' },
];

export interface TransferRowViewProps {
  readonly row: TransferRow;
  readonly selected: boolean;
  readonly onSelect: (transferId: string | null) => void;
  /** Records a decision; it changes nothing but the record. */
  readonly onDecide: (row: TransferRow, decision: TransferDecisionKind, note: string) => void;
  /** Only rows of the server's own plan have a written rationale. */
  readonly withRationale: boolean;
  /** Columns in the table, so the detail row spans all of them. */
  readonly columns: number;
}

/** A full-width row under a transfer: it may wrap, unlike the 36px data rows. */
const DETAIL_CELL = '!h-auto !max-w-none !whitespace-normal !py-3';

/** One transfer: its data row and, with a rationale open, a full-width detail row. */
export function TransferRowView(props: TransferRowViewProps) {
  return props.withRationale ? <RationaleRows {...props} /> : <DataRow {...props} actions={null} />;
}

function RationaleRows(props: TransferRowViewProps) {
  const { row, columns } = props;
  const rationale = useRationale(row.id, row.buses);
  return (
    <>
      <DataRow
        {...props}
        actions={
          <RationaleToggle
            expanded={rationale.expanded}
            onToggle={rationale.toggle}
            panelId={rationale.panelId}
            label={`${row.fromName} to ${row.toName}`}
            status={rationale.status}
          />
        }
      />
      {rationale.expanded ? (
        <tr data-testid={`transfer-detail-${row.id}`}>
          <td colSpan={columns} className={DETAIL_CELL}>
            {samePlaceNote(row) ? (
              <p className="depot-prose mb-2 max-w-[62ch] text-[13px]">{samePlaceNote(row)}</p>
            ) : null}
            <RationalePanel
              id={rationale.panelId}
              expanded={rationale.expanded}
              state={rationale.state}
              onRetry={rationale.retry}
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}

const RATIONALE_ABSENT = 'A written rationale is available for the server plan only.';

function DataRow({
  row,
  selected,
  onSelect,
  onDecide,
  columns,
  actions,
}: TransferRowViewProps & { readonly actions: ReactNode }) {
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

  const samePlace = samePlaceNote(row);
  return (
    <>
      <tr className={selected ? 'depot-row-selected' : undefined} title={samePlace ?? undefined}>
        <td>
          <button
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(selected ? null : row.id)}
            className="depot-link block max-w-[16rem] truncate text-left"
            title={`${row.fromName} to ${row.toName}`}
          >
            {row.fromName} → {row.toName}
          </button>
        </td>
        <td className="depot-align-right">{formatCount(row.buses)}</td>
        <td className="depot-align-right" title={samePlace ?? undefined}>
          {row.distanceKm.toFixed(1)}
        </td>
        <td className="depot-align-right">{row.busKm.toFixed(1)}</td>
        <td className="depot-align-right">{formatCount(row.giverSurplusBefore)}</td>
        <td className="depot-align-right">{formatCount(row.receiverDeficitBefore)}</td>
        <td title={decisionStatusText(row.decision, row.buses)}>
          {decisionStatusText(row.decision, row.buses)}
        </td>
        <td>{actions ?? <span title={RATIONALE_ABSENT}>—</span>}</td>
        <td className="!max-w-none">
          <div className="flex flex-nowrap items-center gap-2">
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
              className="depot-field w-36 py-0.5"
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
          </div>
        </td>
      </tr>
      {error ? (
        <tr>
          <td colSpan={columns} className={DETAIL_CELL}>
            <p role="alert" className="text-[11px] text-alert-amber">
              {error}
            </p>
          </td>
        </tr>
      ) : null}
    </>
  );
}
