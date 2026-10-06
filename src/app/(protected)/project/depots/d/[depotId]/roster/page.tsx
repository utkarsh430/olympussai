import { Suspense } from 'react';
import { RosterPage } from '@/components/depot/roster/RosterPage';
import { LoadingBlock } from '@/components/depot/shell/DataStates';
import { PageHeader } from '@/components/depot/shell/PageHeader';
import { requireDepotPage } from '@/lib/depot/depotGate';

/** Every bus homed at one depot, with its state, place, route and device flags. */
export default async function DepotRosterPage({
  params,
}: {
  readonly params: Promise<{ readonly depotId: string }>;
}) {
  const { depotId } = await params;
  // Layouts do not re-run on client navigation, so the page gates itself too;
  // the id is checked before the session gate sees it.
  await requireDepotPage(depotId, '/roster');

  return (
    <>
      <PageHeader
        title="Roster"
        description="Every bus homed at this depot: what it is doing, where it is, and when it was last heard from. Open a bus to see its timetable."
        provenance="derived"
      />
      <Suspense fallback={<LoadingBlock rows={10} label="Loading the roster" />}>
        <RosterPage />
      </Suspense>
    </>
  );
}
