import { Suspense } from 'react';
import { BusScheduler } from '@/components/depot/os/sched/BusScheduler';
import { requireDepotPage } from '@/lib/depot/depotGate';

/** The depot's AI Bus Scheduler: generate, compare and review the day's bus schedule. */
export default async function DepotBusSchedulerPage({
  params,
}: {
  readonly params: Promise<{ depotId: string }>;
}) {
  const { depotId } = await params;
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireDepotPage(depotId, '/bus-scheduler');
  return (
    <Suspense fallback={null}>
      <BusScheduler />
    </Suspense>
  );
}
