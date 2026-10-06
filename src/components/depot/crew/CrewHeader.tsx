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
 * description whose second sentence is "Availability and rostering only. No individual
 * is assessed." (on the first screen whatever the page shows below), and the MODELLED
 * provenance line, whose second line is the shared modelled-day formula with "Data
 * sources" at its end.
 */
export function CrewHeader({ provenance, modelledDay }: CrewHeaderProps) {
  return (
    <PageHeader
      title="Crew"
      description={`Drivers and conductors available against the day's crew shifts. ${PEOPLE_SENTENCE}`}
      provenanceLine={{
        ...provenance,
        ...(modelledDay === undefined ? {} : { modelledDay }),
      }}
    />
  );
}
