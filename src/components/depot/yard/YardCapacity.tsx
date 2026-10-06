import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import {
  baysMissingSentence,
  capacitySentence,
  fleetOnlyCapacitySentence,
  visitingSentence,
  type CapacityView,
} from '@/lib/depot/yard/parkingModel';

export interface YardCapacityProps {
  readonly capacity: CapacityView;
  /** True while the modelled bay count is still being fetched. */
  readonly baysPending?: boolean;
}

function sentenceFor(capacity: CapacityView, baysPending: boolean): string {
  if (capacity.bays === null) return baysMissingSentence(capacity, baysPending);
  if (capacity.inYard === null) return fleetOnlyCapacitySentence(capacity.fleet, capacity.bays);
  return capacitySentence({
    bays: capacity.bays,
    inYard: capacity.inYard,
    visiting: capacity.visiting,
  });
}

/**
 * Buses in the yard now against the depot master's bays. The counts are the
 * depot detail's, so they survive a failed parking request; the bays are
 * MODELLED (no yard survey is in the feed) and the in-yard count is DERIVED
 * because the yard itself is inferred. With no yard established only the fleet
 * is set against the bays, and no in-yard count is invented.
 */
export function YardCapacity({ capacity, baysPending = false }: YardCapacityProps) {
  const { inYard, bays } = capacity;
  return (
    <section
      aria-labelledby="yard-capacity-heading"
      data-testid="yard-capacity"
      className="depot-panel min-w-0 p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="yard-capacity-heading" className="depot-section-label !mb-0">
          Yard capacity
        </h2>
      </div>
      <p className="mt-2 text-[13px] text-depot-ink" data-testid="yard-capacity-sentence">
        {sentenceFor(capacity, baysPending)}
      </p>
      {inYard !== null && bays !== null ? (
        <p className="depot-prose mt-2 text-xs" data-testid="yard-capacity-visiting">
          {visitingSentence(capacity.visiting)}
        </p>
      ) : null}
      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-depot-muted">
        <span>{inYard === null ? 'Fleet' : 'Buses in the yard'}</span>
        <ProvenanceBadge provenance={inYard === null ? 'live' : 'derived'} />
        {bays === null ? null : (
          <>
            <span>Bays</span>
            <ProvenanceBadge provenance="modelled" />
          </>
        )}
      </p>
    </section>
  );
}
