import { Suspense } from 'react';
import { DecisionCenter } from '@/components/depot/os/decisions/DecisionCenter';
import { requireDepotPage } from '@/lib/depot/depotGate';

/** One depot's AI Decision Center. */
export default async function DepotDecisionCenterPage({
  params,
}: {
  readonly params: Promise<{ depotId: string }>;
}) {
  const { depotId } = await params;
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireDepotPage(depotId, '/decisions');
  return (
    <Suspense fallback={null}>
      <DecisionCenter />
    </Suspense>
  );
}
