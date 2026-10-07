'use client';

import { useId } from 'react';
import {
  ClearControl,
  TRAIL_LIST_CLASS,
  TrailLine,
  TrailStateNotes,
} from '@/components/depot/rebalance/TrailParts';
import { trailHeading } from '@/lib/depot/rebalance/decisionWording';
import type { ProposalTrailItem } from '@/lib/depot/rebalance/proposalDecisionEvents';
import {
  PROPOSAL_TRAIL_NOTE,
  describeProposalTrailItem,
} from '@/lib/depot/rebalance/proposalDecisionWording';

export interface ProposalDecisionTrailProps {
  readonly items: readonly ProposalTrailItem[];
  readonly operatingDate: string;
  readonly onUndo: (item: ProposalTrailItem) => void;
  readonly capacityNote: string | null;
  readonly stateNote: string | null;
  /** Something is stored in this browser that clearing would remove. */
  readonly canClear: boolean;
  readonly onClear: () => void;
}

/**
 * The decisions on route proposals for the date, newest first: the same trail, notes and
 * clear control as the transfers' trail, listing proposals only. Empty, it is one heading
 * line; the note that the trail is kept in this browser and moves no bus stays in view.
 */
export function ProposalDecisionTrail(props: ProposalDecisionTrailProps) {
  const { items, operatingDate, onUndo, capacityNote, stateNote, canClear, onClear } = props;
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="mt-6 min-w-0 print:hidden"
      data-testid="proposal-trail"
    >
      <h3 id={headingId} className="depot-section-label mb-1.5">
        {trailHeading(operatingDate, items.length)}
      </h3>
      <p className="depot-note">{PROPOSAL_TRAIL_NOTE}</p>
      <TrailStateNotes
        capacityNote={capacityNote}
        stateNote={stateNote}
        stateTestId="proposal-trail-state"
      />
      {canClear ? <ClearControl onClear={onClear} /> : null}
      {items.length > 0 ? (
        <ol className={`${TRAIL_LIST_CLASS} mt-3`}>
          {items.map((item, index) => (
            // A damaged store can repeat ids, so the position is part of the key.
            <TrailLine
              key={`${index}-${item.eventId}`}
              at={item.at}
              line={describeProposalTrailItem(item)}
              context={null}
              note={item.note}
              onUndo={item.undoable ? () => onUndo(item) : null}
            />
          ))}
        </ol>
      ) : null}
    </section>
  );
}
