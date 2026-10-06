'use client';

import { useEffect, useId, type ReactNode } from 'react';
import {
  RationalePanel,
  useRationale,
} from '@/components/depot/copilot/RationaleButton';
import { DisclosureChevron } from '@/components/depot/shell/DisclosureChevron';
import { formatCount, formatOneDecimal } from '@/lib/depot/format';
import { samePlaceNote } from '@/lib/depot/rebalance/pageLayout';
import { decisionRowWord, decisionStatusText } from '@/lib/depot/rebalance/decisionWording';
import type { TransferDecisionKind } from '@/lib/depot/rebalance/rebalanceModel';
import { spareBeforeAfter } from '@/lib/depot/rebalance/transferColumns';
import type { TransferRow } from '@/lib/depot/rebalance/transferModel';
import { TransferDecisionControls } from './TransferDecisionControls';

export interface TransferRowViewProps {
  readonly row: TransferRow;
  /** True while this row's expanded row is open (it is also the transfer lit on the map). */
  readonly open: boolean;
  readonly onActivate: (row: TransferRow) => void;
  /** Records a decision; it changes nothing but the record. */
  readonly onDecide: (row: TransferRow, decision: TransferDecisionKind, note: string) => void;
  /** Withdraws the decision in force for this row; null when there is none to undo. */
  readonly onUndo: (() => void) | null;
  /** Only rows of the server's own plan have a written rationale. */
  readonly withRationale: boolean;
  /** Columns in the table, so the expanded row spans all of them. */
  readonly columns: number;
}

/** A full-width row under a transfer: it may wrap, unlike the data rows. */
const DETAIL_CELL = '!h-auto !max-w-none !whitespace-normal !py-3';
/** Table links: cyan, underlined on hover and focus only. */
const TABLE_LINK =
  'depot-table-link text-left text-holo-glow decoration-holo-glow/40 underline-offset-2 hover:underline focus-visible:underline';
/** A long transfer name wraps at a space to a second line inside its cell, never cut. */
const NAME_CELL = '!h-auto !whitespace-normal !py-1.5';

/** One transfer: its data row and, once opened, its expanded row directly under it. */
export function TransferRowView(props: TransferRowViewProps) {
  return props.withRationale ? <RationaleRows {...props} /> : <Rows {...props} rationale={null} />;
}

/** The server plan: opening the row also asks for the written rationale, once. */
function RationaleRows(props: TransferRowViewProps) {
  const { row, open } = props;
  const rationale = useRationale(row.id, row.buses);
  const { expanded, toggle } = rationale;
  // The hook keeps the text when closed; it follows the row's open state.
  useEffect(() => {
    if (open !== expanded) toggle();
  }, [open, expanded, toggle]);
  return (
    <Rows
      {...props}
      rationale={
        <RationalePanel
          id={`${rationale.panelId}-text`}
          expanded={rationale.expanded}
          state={rationale.state}
          onRetry={rationale.retry}
        />
      }
    />
  );
}

function Rows(props: TransferRowViewProps & { readonly rationale: ReactNode }) {
  const { row, open, onActivate, onDecide, onUndo, columns, rationale } = props;
  const detailId = useId();
  const samePlace = samePlaceNote(row);
  const status = decisionStatusText(row.decision, row.buses);
  const name = `${row.fromName} → ${row.toName}`;
  return (
    <>
      <tr
        className={`group depot-row-selectable ${open ? 'depot-row-selected' : ''}`}
        title={samePlace ?? undefined}
        onClick={() => onActivate(row)}
        data-testid={`transfer-row-${row.id}`}
      >
        <td className={NAME_CELL}>
          {/* The keyboard way in: Enter or Space on the name opens the row (its click bubbles). */}
          <button
            type="button"
            aria-expanded={open}
            aria-controls={open ? detailId : undefined}
            aria-label={`${row.fromName} to ${row.toName}, ${formatCount(row.buses)} buses: ${status}`}
            className={TABLE_LINK}
          >
            {name}
          </button>
        </td>
        <td className="depot-align-right">{formatCount(row.buses)}</td>
        <td className="depot-align-right" title={samePlace ?? undefined}>
          {formatOneDecimal(row.distanceKm)}
        </td>
        <td className="depot-align-right">{formatOneDecimal(row.busKm)}</td>
        <td title={status} data-testid="transfer-decision-word">
          {decisionRowWord(row.decision, row.buses)}
        </td>
        <td
          aria-hidden
          className={`!px-1.5 text-center ${open ? '' : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100'}`}
        >
          <DisclosureChevron open={open} />
        </td>
      </tr>
      {open ? (
        <tr data-testid={`transfer-detail-${row.id}`}>
          <td colSpan={columns} className={DETAIL_CELL}>
            <div id={detailId} className="flex min-w-0 flex-col gap-2" data-testid="transfer-block">
              <div className="max-w-[62ch]">
                {samePlace ? <p className="depot-prose mb-2 text-[13px]">{samePlace}</p> : null}
                <p className="depot-prose text-[13px]" data-testid="transfer-spare">
                  {spareBeforeAfter(row)}
                </p>
              </div>
              {rationale}
              <TransferDecisionControls
                row={row}
                status={status}
                onDecide={onDecide}
                onUndo={onUndo}
              />
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
