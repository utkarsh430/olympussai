'use client';

import { EmptyState } from '@/components/depot/shell/DataStates';
import type { TransferDecisionKind } from '@/lib/depot/rebalance/rebalanceModel';
import type { TransferRow } from '@/lib/depot/rebalance/transferModel';
import { TransferTable } from './TransferTable';
import type { DistributionView } from './useDistributionView';

export interface TransferSectionProps {
  readonly view: DistributionView;
  readonly selectedId: string | null;
  readonly onSelect: (transferId: string | null) => void;
  readonly onDecide: (row: TransferRow, decision: TransferDecisionKind, note: string) => void;
}

/** The transfer table (or why there is none) and the shortfall the plan cannot cover. */
export function TransferSection({ view, selectedId, onSelect, onDecide }: TransferSectionProps) {
  return (
    <>
      {view.rows.length ? (
        <TransferTable
          rows={view.rows}
          selectedId={selectedId}
          onSelect={onSelect}
          onDecide={onDecide}
          serverPlan={view.key === null}
        />
      ) : (
        <EmptyState>
          {view.summary.before.totalDeficit === 0
            ? 'No transfers are recommended: no depot is short of buses on the modelled requirement.'
            : 'No transfers are possible: no depot short of buses can be reached from one with spare buses. The shortfall is listed below.'}
        </EmptyState>
      )}
      <h3 className="depot-label mb-1.5 mt-6">Shortfall the plan cannot cover · modelled</h3>
      {view.uncovered.length ? (
        <ul className="depot-prose flex flex-col gap-1">
          {view.uncovered.map((u) => (
            <li key={u.depotId}>{u.sentence}</li>
          ))}
        </ul>
      ) : (
        <p className="depot-prose">Every modelled shortfall is covered by the transfers above.</p>
      )}
    </>
  );
}
