'use client';

import { ProposalDecisionTrail } from './ProposalDecisionTrail';
import type { ProposalDecisions } from './useProposalDecisions';

export interface ProposalDecisionsFooterProps {
  readonly decisions: ProposalDecisions;
  readonly operatingDate: string;
}

/**
 * Under a proposals table: the polite status line of the last decision (recorded, or why
 * not) and the trail of proposal decisions kept in this browser. Neither is printed.
 */
export function ProposalDecisionsFooter({ decisions, operatingDate }: ProposalDecisionsFooterProps) {
  return (
    <>
      <p
        role="status"
        data-testid="proposal-status"
        className="depot-prose mt-2 min-h-5 text-[13px] print:hidden"
      >
        {decisions.announcement}
      </p>
      <ProposalDecisionTrail
        items={decisions.trail}
        operatingDate={operatingDate}
        onUndo={decisions.undo}
        capacityNote={decisions.capacityNote}
        stateNote={decisions.stateNote}
        canClear={decisions.canClear}
        onClear={decisions.clear}
      />
    </>
  );
}
