import Link from 'next/link';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import { SOURCES_HREF, modelledStatement } from '@/lib/depot/crew/crewPageModel';

export interface ModelledStatementProps {
  readonly limits: { readonly dailyHours: number; readonly weeklyHours: number };
}

/** What is modelled, the limits used and the feed that will replace it. */
export function ModelledStatement({ limits }: ModelledStatementProps) {
  return (
    <section aria-labelledby="depot-crew-modelled-heading" className="min-w-0 animate-rise">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="depot-crew-modelled-heading" className="depot-section-label !mb-0">
          About this page
        </h2>
        <ProvenanceBadge provenance="modelled" />
      </div>
      <p className="depot-prose">{modelledStatement(limits)}</p>
      <p className="depot-prose mt-2">
        See{' '}
        <Link href={SOURCES_HREF} className="text-holo-glow underline-offset-2 hover:underline">
          Data sources
        </Link>{' '}
        for the feed this needs.
      </p>
    </section>
  );
}
