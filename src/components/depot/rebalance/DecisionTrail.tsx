'use client';

import { useState } from 'react';
import { formatInstantIst } from '@/lib/depot/format';
import type { DecisionTrail as Trail, TrailItem } from '@/lib/depot/rebalance/decisionEvents';
import {
  TRAIL_CLEAR_CONFIRM,
  TRAIL_NOTE,
  describeTrailItem,
  trailHeading,
} from '@/lib/depot/rebalance/decisionWording';

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

/** "Clear trail", then a confirm step: clearing removes every entry and cannot be undone. */
function ClearControl({ onClear }: { readonly onClear: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button type="button" className="depot-link mt-2 text-[11px]" onClick={() => setConfirming(true)}>
        Clear trail
      </button>
    );
  }
  return (
    <div role="group" aria-label="Clear the decision trail" className="mt-2 flex flex-wrap items-center gap-3">
      <span className="depot-prose text-[13px]">{TRAIL_CLEAR_CONFIRM}</span>
      <button
        type="button"
        className="depot-filter-button"
        onClick={() => {
          setConfirming(false);
          onClear();
        }}
      >
        Clear the trail
      </button>
      <button type="button" className="depot-filter-button" onClick={() => setConfirming(false)}>
        Keep it
      </button>
    </div>
  );
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
      <ol className="flex flex-col divide-y divide-depot-line rounded-md border border-depot-line">
        {items.map((item, index) => (
          // A damaged store can repeat ids, so the position is part of the key.
          <li
            key={`${index}-${item.eventId}`}
            className="flex min-w-0 flex-wrap items-baseline gap-x-3 px-3 py-2"
          >
            <span className="text-[11px] text-depot-faint">{formatInstantIst(item.at)}</span>
            <span className="min-w-0 flex-1 text-[13px] text-depot-ink">
              {describeTrailItem(item)}
              {item.scenario ? (
                <span className="block text-[11px] text-depot-muted">
                  What-if: {item.scenarioLabel ?? 'a what-if scenario'}
                </span>
              ) : null}
              {item.note ? (
                <span className="block font-sans text-xs text-depot-muted">Note: {item.note}</span>
              ) : null}
            </span>
            {item.undoable ? (
              <button type="button" className="depot-link text-[11px]" onClick={() => onUndo(item)}>
                Undo
              </button>
            ) : null}
          </li>
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
      {capacityNote ? <p className="depot-note mt-2 text-alert-amber">{capacityNote}</p> : null}
      {stateNote ? (
        <p className="depot-note mt-2 text-alert-amber" data-testid="rebalance-trail-state">
          {stateNote}
        </p>
      ) : null}
      {canClear ? <ClearControl onClear={onClear} /> : null}
      <List label="On the modelled plan" items={trail.baseline} onUndo={onUndo} />
      <List label="On what-if scenarios" items={trail.scenario} onUndo={onUndo} />
    </section>
  );
}
