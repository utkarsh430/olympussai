'use client';

import type { TransferDecisionKind } from '@/lib/depot/rebalance/rebalanceModel';
import type { TransferRow } from '@/lib/depot/rebalance/transferModel';
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

const HEADERS = [
  'Transfer',
  'Buses · modelled',
  'Road km · modelled',
  'Bus-km · modelled',
  'Giver spare before · modelled',
  'Receiver short before · modelled',
  'Decision',
  'Record a decision',
] as const;

export const RATIONALE_SERVER_ONLY = 'A written rationale is available for the server plan only.';

/**
 * Recommended transfers with the context a planner decides on. Selecting a
 * row highlights its arc and depots on the map. Approve, Reject and Defer
 * only add to the local record; no transfer order is issued.
 */
export function TransferTable({
  rows,
  selectedId,
  onSelect,
  onDecide,
  serverPlan,
}: TransferTableProps) {
  return (
    <>
      {serverPlan ? null : <p className="depot-prose mb-2 text-xs">{RATIONALE_SERVER_ONLY}</p>}
      <div
        role="region"
        aria-label="Recommended transfers"
        tabIndex={0}
        className="depot-table-frame"
        data-testid="rebalance-transfers"
      >
        <table className="depot-table">
          <caption className="caption-top px-3 py-2 text-left font-sans text-xs text-depot-muted">
            Recommended transfers between depots, largest first · modelled. A decision is recorded
            only; nothing is dispatched.
          </caption>
          <thead>
            <tr>
              {HEADERS.map((h, i) => (
                <th
                  key={h}
                  scope="col"
                  className={i > 0 && i < 6 ? 'depot-align-right' : undefined}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <TransferRowView
                key={row.id}
                row={row}
                selected={row.id === selectedId}
                onSelect={onSelect}
                onDecide={onDecide}
                withRationale={serverPlan}
                columns={HEADERS.length}
              />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
