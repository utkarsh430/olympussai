import { PageHeader } from '@/components/depot/shell/PageHeader';
import { PEOPLE_SENTENCE } from '@/lib/depot/crew/crewPageModel';
import type { ProvenanceDescription } from '@/lib/depot/provenanceLine';

/** The crew page's default provenance, declared by the route page (the feed id is checked there). */
export type CrewProvenance = Extract<ProvenanceDescription, { readonly default: 'modelled' }>;

export interface CrewHeaderProps {
  /** The route page's declaration: MODELLED, what replaces it, the feed it links to. */
  readonly provenance: CrewProvenance;
  /**
   * The modelled-day sentence (dated, with the feed's schedule coverage), placed in the
   * provenance line's extension; absent while the page has not loaded its day.
   */
  readonly modelledDay?: string;
}

/**
 * The crew page's header in every state (loading, error, empty, data): the title, the
 * MODELLED provenance line with the modelled day when known, and the people sentence 8px
 * under the line, so "Availability and rostering only. No individual is assessed." is on
 * the first screen whatever the page shows below.
 */
export function CrewHeader({ provenance, modelledDay }: CrewHeaderProps) {
  return (
    <>
      <PageHeader
        title="Crew"
        description="Drivers and conductors available against the day's crew shifts."
        provenanceLine={{
          ...provenance,
          ...(modelledDay === undefined ? {} : { modelledDay }),
        }}
      />
      {/* The header ends with a 24px margin; -16px leaves 8px under the provenance line. */}
      <p className="depot-prose -mt-4 mb-6" data-testid="crew-people-sentence">
        {PEOPLE_SENTENCE}
      </p>
    </>
  );
}
