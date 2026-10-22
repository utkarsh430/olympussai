import { Suspense } from 'react';
import { JointOptimizer } from '@/components/depot/os/sched/JointOptimizer';
import { requireDepotPage } from '@/lib/depot/depotGate';

/** The depot's Joint Fleet & Crew Optimizer: buses and crews planned together. */
export default async function DepotJointOptimizerPage({
  params,
}: {
  readonly params: Promise<{ depotId: string }>;
}) {
  const { depotId } = await params;
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireDepotPage(depotId, '/optimizer');
  return (
    <Suspense fallback={null}>
      <JointOptimizer />
    </Suspense>
  );
}
