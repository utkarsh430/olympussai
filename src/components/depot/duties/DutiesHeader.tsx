import { PageHeader } from '@/components/depot/shell/PageHeader';
import { DUTIES_DESCRIPTION, dutyProvenance } from '@/lib/depot/duties/dutyStanding';

/**
 * The duty page's header in every state. The page default is MIXED (bus states derived,
 * duties and the matching modelled); once the board has loaded, the dated modelled-day
 * sentence rides in the provenance line's extension, so nothing floats above the hero.
 */
export function DutiesHeader({ modelledDay }: { readonly modelledDay?: string }) {
  return (
    <PageHeader
      title="Duties"
      description={DUTIES_DESCRIPTION}
      provenanceLine={dutyProvenance(modelledDay)}
    />
  );
}
