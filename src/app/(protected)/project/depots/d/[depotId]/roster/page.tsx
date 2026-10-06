import { Suspense } from 'react';
import { RosterPage } from '@/components/depot/roster/RosterPage';
import { StatePanel } from '@/components/depot/shell/StatePanel';
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
        description="Every bus homed here: its state, place and last report. Open one for its timetable."
        provenanceLine={{ default: 'derived' }}
      />
      <Suspense fallback={<StatePanel kind="loading" rows={10} sentence="Loading the roster" />}>
        <RosterPage />
      </Suspense>
    </>
  );
}
