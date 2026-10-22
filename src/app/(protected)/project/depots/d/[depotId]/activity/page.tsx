import { Suspense } from 'react';
import { ActivityView } from '@/components/depot/os/ai/ActivityView';
import { requireDepotPage } from '@/lib/depot/depotGate';

/** The AI engine's activity for one depot. */
export default async function DepotActivityPage({
  params,
}: {
  readonly params: Promise<{ depotId: string }>;
}) {
  const { depotId } = await params;
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireDepotPage(depotId, '/activity');
  return (
    <Suspense fallback={null}>
      <ActivityView />
    </Suspense>
  );
}
