import { Suspense } from 'react';
import { DisruptionView } from '@/components/depot/os/reliability/DisruptionView';
import { requireDepotPage } from '@/lib/depot/depotGate';

/** One depot's disruption propagation: what a lost bus takes with it, and the recoveries. */
export default async function DepotDisruptionPage({
  params,
}: {
  readonly params: Promise<{ depotId: string }>;
}) {
  const { depotId } = await params;
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireDepotPage(depotId, '/disruption');
  return (
    <Suspense fallback={null}>
      <DisruptionView />
    </Suspense>
  );
}
