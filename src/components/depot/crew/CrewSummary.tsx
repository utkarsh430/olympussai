import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import type { CrewResponse } from '@/lib/depot/crew/api';
import {
  dutiesSentence,
  reliefSentence,
  shiftsSentence,
  strengthSentence,
} from '@/lib/depot/crew/crewPageModel';
import { formatCount } from '@/lib/depot/format';

interface FigureProps {
  readonly label: string;
  readonly value: string;
}

function Figure({ label, value }: FigureProps) {
  return (
    <div className="min-w-0 p-3">
      <dt className="depot-label">{label}</dt>
      <dd className="mt-1 tabular-nums">
        {value} <ProvenanceBadge provenance="modelled" />
      </dd>
    </div>
  );
}

export interface CrewSummaryProps {
  readonly summary: CrewResponse['summary'];
}

/** Today's shifts and crew strength, in figures and in words; every figure is tagged MODELLED. */
export function CrewSummary({ summary }: CrewSummaryProps) {
  const f = formatCount;
  return (
    <section aria-labelledby="depot-crew-summary-heading" className="min-w-0 animate-rise">
      <h2 id="depot-crew-summary-heading" className="depot-section-label">
        Today&rsquo;s cover
      </h2>
      <dl className="depot-panel grid grid-cols-2 gap-px overflow-hidden font-mono text-[13px] text-depot-ink md:grid-cols-4">
        <Figure label="Shifts required" value={f(summary.shiftsRequired)} />
        <Figure label="Shifts covered" value={f(summary.shiftsCovered)} />
        <Figure label="Shifts uncovered" value={f(summary.shiftsUncovered)} />
        <Figure label="Duties needing relief" value={f(summary.dutiesNeedingRelief)} />
        <Figure
          label="Drivers available / required"
          value={`${f(summary.driver.available)} / ${f(summary.driver.required)}`}
        />
        <Figure
          label="Conductors available / required"
          value={`${f(summary.conductor.available)} / ${f(summary.conductor.required)}`}
        />
        <Figure label="Duties fully covered" value={f(summary.dutiesFullyCovered)} />
        <Figure
          label="Duties partly / not covered"
          value={`${f(summary.dutiesPartlyCovered)} / ${f(summary.dutiesUncovered)}`}
        />
      </dl>
      <div className="depot-prose mt-3 space-y-1" role="status">
        <p>{shiftsSentence(summary.shiftsRequired, summary.shiftsCovered, summary.shiftsUncovered)}</p>
        <p>
          {strengthSentence('driver', summary.driver)}{' '}
          {strengthSentence('conductor', summary.conductor)}
        </p>
        <p>
          {dutiesSentence(
            summary.dutiesFullyCovered,
            summary.dutiesPartlyCovered,
            summary.dutiesUncovered,
          )}{' '}
          {reliefSentence(summary.dutiesNeedingRelief)}
        </p>
      </div>
    </section>
  );
}
