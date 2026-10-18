import { Suspense } from 'react';
import { FuelAuditView } from '@/components/depot/os/finance/FuelAuditView';
import { requireDepotPage } from '@/lib/depot/depotGate';

/** One depot's fuel audit. */
export default async function DepotFuelAuditPage({
  params,
}: {
  readonly params: Promise<{ depotId: string }>;
}) {
  const { depotId } = await params;
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireDepotPage(depotId, '/fuel-audit');
  return (
    <Suspense fallback={null}>
      <FuelAuditView />
    </Suspense>
  );
}
