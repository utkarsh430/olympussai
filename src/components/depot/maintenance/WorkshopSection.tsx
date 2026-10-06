import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import { formatCount } from '@/lib/depot/format';
import type { MaintenanceResponse } from '@/lib/depot/maintenance/api';
import { workshopSentence } from '@/lib/depot/maintenance/text';

export interface WorkshopSectionProps {
  readonly workshop: MaintenanceResponse['workshop'];
}

/**
 * Off-road buses against the modelled bays, in numbers and one sentence. Plain
 * figures rather than a bar: three counts and a sentence carry it.
 */
export function WorkshopSection({ workshop }: WorkshopSectionProps) {
  const { load } = workshop;
  return (
    <section aria-labelledby="depot-workshop-heading" className="min-w-0 animate-rise">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="depot-workshop-heading" className="depot-section-label !mb-0">
          Workshop load
        </h2>
        <ProvenanceBadge provenance="modelled" />
      </div>
      <dl className="depot-panel grid grid-cols-3 gap-px overflow-hidden font-mono text-[13px] text-depot-ink">
        <div className="min-w-0 p-3">
          <dt className="depot-label">Bays</dt>
          <dd className="mt-1 tabular-nums">
            {formatCount(load.bays)} <ProvenanceBadge provenance="modelled" />
          </dd>
        </div>
        <div className="min-w-0 p-3">
          <dt className="depot-label">Off the road</dt>
          <dd className="mt-1 tabular-nums">
            {formatCount(load.offRoad)} <ProvenanceBadge provenance="live" />
          </dd>
        </div>
        <div className="min-w-0 p-3">
          <dt className="depot-label">Waiting</dt>
          <dd className="mt-1 tabular-nums">
            {formatCount(load.queue)} <ProvenanceBadge provenance="modelled" />
          </dd>
        </div>
      </dl>
      <p className="depot-prose mt-3" role="status">
        {workshopSentence(load)}
      </p>
    </section>
  );
}
