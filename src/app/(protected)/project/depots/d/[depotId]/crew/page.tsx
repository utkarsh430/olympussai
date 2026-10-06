import { Suspense } from 'react';
import { CrewPage } from '@/components/depot/crew/CrewPage';
import { LoadingBlock } from '@/components/depot/shell/DataStates';
import { PageHeader } from '@/components/depot/shell/PageHeader';
import { PEOPLE_SENTENCE } from '@/lib/depot/crew/crewPageModel';
import { requireDepotPage } from '@/lib/depot/depotGate';

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

  return (
    <>
      <PageHeader
        title="Crew"
        description={`${PEOPLE_SENTENCE} Drivers and conductors available against the day's crew shifts, and the shifts that have no crew. Nothing here is written back to any system.`}
        provenance="modelled"
      />
      <Suspense fallback={<LoadingBlock rows={14} label="Loading the crew view" />}>
        <CrewPage />
      </Suspense>
    </>
  );
}
