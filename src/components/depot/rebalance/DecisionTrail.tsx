'use client';

import type { DecisionTrail as Trail, TrailItem } from '@/lib/depot/rebalance/decisionEvents';
import { TRAIL_NOTE, describeTrailItem, trailHeading } from '@/lib/depot/rebalance/decisionWording';
import { ClearControl, TRAIL_LIST_CLASS, TrailLine, TrailStateNotes } from './TrailParts';

export interface DecisionTrailProps {
  readonly trail: Trail;
  readonly operatingDate: string;
  readonly onUndo: (item: TrailItem) => void;
  /** Said once the storage cap has dropped older decisions; null until then. */
  readonly capacityNote: string | null;
  /** What of the stored record is not listed (damaged or skipped entries); null when all is. */
  readonly stateNote: string | null;
  /** Something is stored in this browser that clearing would remove. */
  readonly canClear: boolean;
  readonly onClear: () => void;
}

function List({
  label,
  items,
  onUndo,
}: {
  readonly label: string;
  readonly items: readonly TrailItem[];
  readonly onUndo: (item: TrailItem) => void;
}) {
  if (items.length === 0) return null;
  return (
    <>
      <h3 className="depot-label mb-1.5 mt-4">{label}</h3>
      <ol className={TRAIL_LIST_CLASS}>
        {items.map((item, index) => (
          // A damaged store can repeat ids, so the position is part of the key.
          <TrailLine
            key={`${index}-${item.eventId}`}
            at={item.at}
            line={describeTrailItem(item)}
            context={item.scenario ? `What-if: ${item.scenarioLabel ?? 'a what-if scenario'}` : null}
            note={item.note}
            onUndo={item.undoable ? () => onUndo(item) : null}
          />
        ))}
      </ol>
    </>
  );
}

/**
 * Every decision for the operating date, newest first, with decisions on the baseline plan
 * listed apart from decisions on a what-if scenario. Empty, it is one heading line saying
 * none is recorded; the note that the trail is a local, append-only record and that
 * nothing is dispatched stays visible in every state.
 */
export function DecisionTrail(props: DecisionTrailProps) {
  const { trail, operatingDate, onUndo, capacityNote, stateNote, canClear, onClear } = props;
  const entries = trail.baseline.length + trail.scenario.length;
  return (
    <section aria-labelledby="rebalance-trail-heading" data-testid="rebalance-trail">
      <h2 id="rebalance-trail-heading" className="depot-section-label mb-1.5">
        {trailHeading(operatingDate, entries)}
      </h2>
      <p className="depot-note" data-testid="rebalance-trail-note">
        {TRAIL_NOTE}
      </p>
      <TrailStateNotes
        capacityNote={capacityNote}
        stateNote={stateNote}
        stateTestId="rebalance-trail-state"
      />
      {canClear ? <ClearControl onClear={onClear} /> : null}
      <List label="On the modelled plan" items={trail.baseline} onUndo={onUndo} />
      <List label="On what-if scenarios" items={trail.scenario} onUndo={onUndo} />
    </section>
  );
}
