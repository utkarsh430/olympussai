'use client';

import { useRef, useState } from 'react';
import { TableOverflowCue, useColumnsToTheRight } from '@/components/depot/shell/TableOverflowCue';
import { formatCount } from '@/lib/depot/format';
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
  /** True while the rows are the server's own plan, the only plan with a written rationale. */
  readonly serverPlan: boolean;
}

export const RATIONALE_SERVER_ONLY = 'A written rationale is available for the server plan only.';

/**
 * Recommended transfers on the shared table options (36px rows that never wrap, the
 * transfer frozen, the shared overflow cue over the header row only), ten at first. The
 * fixed column widths sum to less than the frame at 1440 (`transferColumns`), so no column
 * is cut there; a narrower frame scrolls sideways inside itself. No "· modelled" in the
 * headers: the section label carries the tag. Selecting a row highlights its arc
 * and depots on the map. Approve, Reject and Defer only add to the local record.
 */
export function TransferTable({
  rows,
  selectedId,
  onSelect,
  onDecide,
  serverPlan,
}: TransferTableProps) {
  const [showAll, setShowAll] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const moreColumns = useColumnsToTheRight(frame, true);
  const preview = transferPreview(rows, showAll, selectedId);
  return (
    <div className="min-w-0">
      {serverPlan ? null : <p className="depot-note mb-2">{RATIONALE_SERVER_ONLY}</p>}
      <div className="relative min-w-0">
        <div
          ref={frame}
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
                    {h.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row) => (
                <TransferRowView
                  key={row.id}
                  row={row}
                  selected={row.id === selectedId}
                  onSelect={onSelect}
                  onDecide={onDecide}
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
        <button
          type="button"
          className="depot-link mt-2 text-[13px]"
          aria-expanded={showAll}
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? 'Show the first ten' : `Show all ${formatCount(rows.length)} transfers`}
        </button>
      ) : null}
    </div>
  );
}
