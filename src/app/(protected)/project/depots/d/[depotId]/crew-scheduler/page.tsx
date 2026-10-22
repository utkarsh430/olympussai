import { Suspense } from 'react';
import { CrewScheduler } from '@/components/depot/os/sched/CrewScheduler';
import { requireDepotPage } from '@/lib/depot/depotGate';

/** The depot's AI Crew Scheduler: generate and review the day's driver and conductor roster. */
export default async function DepotCrewSchedulerPage({
  params,
}: {
  readonly params: Promise<{ depotId: string }>;
}) {
  const { depotId } = await params;
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireDepotPage(depotId, '/crew-scheduler');
  return (
    <Suspense fallback={null}>
      <CrewScheduler />
    </Suspense>
  );
}
