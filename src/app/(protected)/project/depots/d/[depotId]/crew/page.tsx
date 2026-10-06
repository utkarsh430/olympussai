import { Suspense } from 'react';
import { CrewHeader, type CrewProvenance } from '@/components/depot/crew/CrewHeader';
import { CrewPage } from '@/components/depot/crew/CrewPage';
import { LoadingBlock } from '@/components/depot/shell/DataStates';
import { requireDepotPage } from '@/lib/depot/depotGate';

/** The page's default provenance; the header adds the modelled day once the data is in. */
const PROVENANCE: CrewProvenance = {
  default: 'modelled',
  replacedBy: 'a crew roster and leave feed',
  feedId: 'crew-duties',
};

/** Crew availability against the day's shifts, and which shifts have no crew and why. */
export default async function DepotCrewPage({
  params,
}: {
  readonly params: Promise<{ readonly depotId: string }>;
}) {
  const { depotId } = await params;
  // Layouts do not re-run on client navigation, so the page gates itself too;
  // the id is checked before the session gate sees it.
  await requireDepotPage(depotId, '/crew');

  // The header is drawn by `CrewPage` (its provenance line carries the modelled day, which
  // the page's own data supplies); the fallback draws it too, so no state is without it.
  return (
    <Suspense
      fallback={
        <>
          <CrewHeader provenance={PROVENANCE} />
          <LoadingBlock rows={14} label="Loading the crew view" />
        </>
      }
    >
      <CrewPage provenance={PROVENANCE} />
    </Suspense>
  );
}
