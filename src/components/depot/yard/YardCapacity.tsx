import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import {
  capacitySentence,
  fleetOnlyCapacitySentence,
  visitingSentence,
} from '@/lib/depot/yard/parkingModel';
import type { ParkingCapacity } from '@/lib/depot/yard/parkingApi';

export interface YardCapacityProps {
  readonly capacity: ParkingCapacity;
}

/**
 * Buses in the yard now against the depot master's bays. The bays are MODELLED
 * (no yard survey is in the feed); the in-yard count is DERIVED because the
 * yard itself is inferred. With no yard established only the fleet is set
 * against the bays, and no in-yard count is invented.
 */
export function YardCapacity({ capacity }: YardCapacityProps) {
  const inYard = capacity.inYard.value;
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
      {inYard === null ? (
        <p className="mt-2 text-[13px] text-depot-ink" data-testid="yard-capacity-sentence">
          {fleetOnlyCapacitySentence(capacity.fleet.value, capacity.bays.value)}
        </p>
      ) : (
        <>
          <p className="mt-2 text-[13px] text-depot-ink" data-testid="yard-capacity-sentence">
            {capacitySentence({
              bays: capacity.bays.value,
              inYard,
              visiting: capacity.visiting.value,
            })}
          </p>
          <p className="depot-prose mt-2 text-xs" data-testid="yard-capacity-visiting">
            {visitingSentence(capacity.visiting.value)}
          </p>
        </>
      )}
      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-depot-muted">
        <span>{inYard === null ? 'Fleet' : 'Buses in the yard'}</span>
        <ProvenanceBadge
          provenance={inYard === null ? capacity.fleet.provenance : capacity.inYard.provenance}
        />
        <span>Bays</span>
        <ProvenanceBadge provenance={capacity.bays.provenance} />
      </p>
    </section>
  );
}
