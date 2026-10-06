import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { workshopRows } from '@/lib/depot/maintenance/pageModel';
import { workshopSentence } from '@/lib/depot/maintenance/text';
import type { WorkshopLoad } from '@/lib/depot/maintenance/workshop';

export interface WorkshopSectionProps {
  /** Modelled bays against the live off-road count taken from the depot detail. */
  readonly load: WorkshopLoad;
}

/**
 * Off-road buses against the modelled bays: the actionable sentence first ("N would
 * wait for a bay"), then three small rows. The off-road row is the live count, the
 * same number as the band's.
 */
export function WorkshopSection({ load }: WorkshopSectionProps) {
  return (
    <section aria-labelledby="depot-workshop-heading" className="min-w-0 animate-rise">
      <SectionLabel id="depot-workshop-heading" label="Workshop load" tag="modelled" />
      <p className="depot-prose mb-3 text-depot-ink" role="status">
        {workshopSentence(load)}
      </p>
      <dl className="divide-y divide-depot-line border-y border-depot-line font-mono text-[13px]">
        {workshopRows(load).map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3 py-2">
            <dt className="flex min-w-0 items-center gap-2 text-depot-muted">
              <span className="truncate">{row.label}</span>
              {row.tag ? <ProvenanceBadge provenance={row.tag} /> : null}
            </dt>
            <dd className="tabular-nums text-depot-ink">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
