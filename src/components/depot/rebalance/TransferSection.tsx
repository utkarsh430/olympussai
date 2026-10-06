'use client';

import { StatePanel } from '@/components/depot/shell/StatePanel';
import type { TransferDecisionKind } from '@/lib/depot/rebalance/rebalanceModel';
import type { TransferRow } from '@/lib/depot/rebalance/transferModel';
import { TransferTable } from './TransferTable';
import type { DistributionView } from './useDistributionView';

export interface TransferSectionProps {
  readonly view: DistributionView;
  readonly selectedId: string | null;
  readonly onSelect: (transferId: string | null) => void;
  readonly onDecide: (row: TransferRow, decision: TransferDecisionKind, note: string) => void;
  readonly undoFor: (row: TransferRow) => (() => void) | null;
}

export const ALL_COVERED = 'Every modelled shortfall is covered';
const NONE_SHORT =
  'No transfers are recommended: no depot is short of buses on the modelled requirement.';
const NONE_REACHABLE =
  'No transfers are possible: no depot short of buses can be reached from one with surplus buses.';
const REACH_REMEDY = 'A longer maximum transfer distance in the what-if may reach one.';

/**
 * The transfer table (or the state panel saying why there is none), then the shortfall the
 * plan cannot cover: a full list only when there is something to list, otherwise one
 * compact status line with its square.
 */
export function TransferSection({
  view,
  selectedId,
  onSelect,
  onDecide,
  undoFor,
}: TransferSectionProps) {
  const nobodyShort = view.summary.before.totalDeficit === 0;
  return (
    <div className="min-w-0">
      {view.rows.length ? (
        <TransferTable
          rows={view.rows}
          selectedId={selectedId}
          onSelect={onSelect}
          onDecide={onDecide}
          undoFor={undoFor}
          serverPlan={view.key === null}
        />
      ) : (
        <StatePanel
          kind="empty"
          sentence={nobodyShort ? NONE_SHORT : NONE_REACHABLE}
          remedy={nobodyShort ? undefined : REACH_REMEDY}
          testId="rebalance-no-transfers"
        />
      )}
      {view.uncovered.length ? (
        <div data-testid="rebalance-uncovered">
          <h3 className="depot-label mb-1.5 mt-6">Shortfall the plan cannot cover</h3>
          <ul className="depot-prose flex flex-col gap-1">
            {view.uncovered.map((u) => (
              <li key={u.depotId}>{u.sentence}</li>
            ))}
          </ul>
        </div>
      ) : nobodyShort ? null : (
        <div className="mt-3">
          <StatePanel
            kind="empty"
            compact
            tone="ok"
            sentence={ALL_COVERED}
            testId="rebalance-covered"
          />
        </div>
      )}
    </div>
  );
}
