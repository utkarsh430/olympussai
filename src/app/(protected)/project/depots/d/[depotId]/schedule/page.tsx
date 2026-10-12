import { Suspense } from 'react';
import { ScheduleHeader } from '@/components/depot/schedule/ScheduleHeader';
import { SchedulePage } from '@/components/depot/schedule/SchedulePage';
import { LoadingBlock } from '@/components/depot/shell/DataStates';
import { requireDepotPage } from '@/lib/depot/depotGate';

/** The depot's AI Scheduler: buses, drivers and conductors on the day's routes with the fewest resources. */
export default async function DepotSchedulePage({
  params,
}: {
  readonly params: Promise<{ readonly depotId: string }>;
}) {
  const { depotId } = await params;
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireDepotPage(depotId, '/schedule');
  return (
    <Suspense
      fallback={
        <>
          <ScheduleHeader />
          <LoadingBlock rows={12} label="Loading the schedule" />
        </>
      }
    >
      <SchedulePage />
    </Suspense>
  );
}
