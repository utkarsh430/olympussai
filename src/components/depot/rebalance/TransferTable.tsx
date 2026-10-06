'use client';

import { useEffect, useRef, useState } from 'react';
import { TableOverflowCue, useColumnsToTheRight } from '@/components/depot/shell/TableOverflowCue';
import { ShowAllButton } from '@/components/depot/shell/LongLists';
import { transferPreview } from '@/lib/depot/rebalance/pageLayout';
import type { TransferDecisionKind } from '@/lib/depot/rebalance/rebalanceModel';
import type { TransferRow } from '@/lib/depot/rebalance/transferModel';
import { TRANSFER_COLUMNS, TRANSFER_TABLE_PX } from '@/lib/depot/rebalance/transferColumns';
import { TransferRowView } from './TransferRowView';

export interface TransferTableProps {
  readonly rows: readonly TransferRow[];
  readonly selectedId: string | null;
  readonly onSelect: (transferId: string | null) => void;
  /** Records a decision; it changes nothing but the record. */
  readonly onDecide: (row: TransferRow, decision: TransferDecisionKind, note: string) => void;
  /** The undo for a row's decision in force, or null when it has none. */
  readonly undoFor?: (row: TransferRow) => (() => void) | null;
  /** True while the rows are the server's own plan, the only plan with a written rationale. */
  readonly serverPlan: boolean;
}

export const RATIONALE_SERVER_ONLY = 'A written rationale is available for the server plan only.';

/**
 * Recommended transfers (the transfer frozen, the shared overflow cue over the header row
 * only), ten at first. The fixed column widths sum to less than the frame at 1440
 * (`transferColumns`), so no column is cut there; a long transfer name wraps to a second
 * line. No "· modelled" in the headers: the section label carries the tag. The row is the
 * control: a click, or Enter on its name, opens its expanded row (rationale, figures,
 * decision) and lights the transfer on the map; one row is open at a time, and a transfer
 * picked on the map opens its row. Approve, Reject and Defer only add to the local record.
 */
export function TransferTable({
  rows,
  selectedId,
  onSelect,
  onDecide,
  undoFor,
  serverPlan,
}: TransferTableProps) {
  const [showAll, setShowAll] = useState(false);
  const [openId, setOpenId] = useState<string | null>(selectedId);
  // A transfer picked on the map opens its row here.
  useEffect(() => {
    if (selectedId !== null) setOpenId(selectedId);
  }, [selectedId]);
  const activate = (row: TransferRow): void => {
    const next = openId === row.id ? null : row.id;
    setOpenId(next);
    onSelect(next);
  };
  const frame = useRef<HTMLDivElement>(null);
  const moreColumns = useColumnsToTheRight(frame, true);
  const preview = transferPreview(rows, showAll, openId);
  return (
    <div className="min-w-0">
      {serverPlan ? null : <p className="depot-note mb-2">{RATIONALE_SERVER_ONLY}</p>}
      <div className="relative min-w-0">
        <div
          ref={frame}
          id="rebalance-transfers"
          role="region"
          aria-label="Recommended transfers"
          tabIndex={0}
          className="depot-table-frame"
          data-testid="rebalance-transfers"
        >
          <table
            className="depot-table depot-table-fixed depot-table-frozen table-fixed"
            style={{ minWidth: TRANSFER_TABLE_PX }}
          >
            <caption className="sr-only">
              Recommended transfers between depots, largest first, modelled. A decision is
              recorded only; nothing is dispatched.
            </caption>
            <thead>
              <tr>
                {TRANSFER_COLUMNS.map((h) => (
                  <th
                    key={h.key}
                    scope="col"
                    style={{ width: h.widthPx }}
                    className={h.right ? 'depot-align-right' : undefined}
                  >
                    {h.label === '' ? <span className="sr-only">Open</span> : h.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row) => (
                <TransferRowView
                  key={row.id}
                  row={row}
                  open={row.id === openId}
                  onActivate={activate}
                  onDecide={onDecide}
                  onUndo={undoFor?.(row) ?? null}
                  withRationale={serverPlan}
                  columns={TRANSFER_COLUMNS.length}
                />
              ))}
            </tbody>
          </table>
        </div>
        {moreColumns ? <TableOverflowCue /> : null}
      </div>
      {preview.hidden > 0 || showAll ? (
        <div className="mt-2">
          <ShowAllButton
            total={rows.length}
            expanded={showAll}
            onToggle={() => setShowAll((v) => !v)}
            controls="rebalance-transfers"
          />
        </div>
      ) : null}
    </div>
  );
}
