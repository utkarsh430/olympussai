'use client';

import type { DecisionTrail as Trail, TrailItem } from '@/lib/depot/rebalance/decisionEvents';
import { describeTrailItem } from '@/lib/depot/rebalance/decisionWording';

export interface DecisionTrailProps {
  readonly trail: Trail;
  readonly operatingDate: string;
  readonly onUndo: (item: TrailItem) => void;
  /** Said once the storage cap has dropped older decisions; null until then. */
  readonly capacityNote: string | null;
}

function timeOf(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function List({
  items,
  empty,
  onUndo,
}: {
  readonly items: readonly TrailItem[];
  readonly empty: string;
  readonly onUndo: (item: TrailItem) => void;
}) {
  if (items.length === 0) return <p className="depot-prose text-xs">{empty}</p>;
  return (
    <ol className="flex flex-col divide-y divide-depot-line rounded-md border border-depot-line">
      {items.map((item) => (
        <li key={item.eventId} className="flex min-w-0 flex-wrap items-baseline gap-x-3 px-3 py-2">
          <span className="text-[11px] text-depot-faint">{timeOf(item.at)}</span>
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
  );
}

/**
 * Every decision for the operating date, newest first, with decisions on the
 * baseline plan listed apart from decisions on a what-if scenario.
 */
export function DecisionTrail({ trail, operatingDate, onUndo, capacityNote }: DecisionTrailProps) {
  return (
    <section aria-labelledby="rebalance-trail-heading" data-testid="rebalance-trail">
      <h2 id="rebalance-trail-heading" className="depot-section-label">
        Decision trail, {operatingDate}
      </h2>
      <p className="depot-prose mb-3 text-xs">
        Decisions are kept in this browser only and are not sent anywhere. The trail is append-only:
        Undo records a further entry and deletes nothing. A decision changes nothing but this
        record; no transfer order is issued.
      </p>
      {capacityNote ? (
        <p className="depot-prose mb-3 text-xs text-alert-amber">{capacityNote}</p>
      ) : null}
      <h3 className="depot-label mb-1.5">On the modelled plan</h3>
      <List
        items={trail.baseline}
        empty="No decisions on the modelled plan for this date yet."
        onUndo={onUndo}
      />
      <h3 className="depot-label mb-1.5 mt-4">On what-if scenarios</h3>
      <List
        items={trail.scenario}
        empty="No decisions on a what-if scenario for this date yet."
        onUndo={onUndo}
      />
    </section>
  );
}
