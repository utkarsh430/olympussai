import { Suspense } from 'react';
import { RevenuePage } from '@/components/depot/revenue/RevenuePage';
import { LoadingBlock } from '@/components/depot/shell/DataStates';
import { PageHeader } from '@/components/depot/shell/PageHeader';
import { requireDepotPage } from '@/lib/depot/depotGate';

/** One depot's modelled revenue and ridership per route for the operating date. */
export default async function DepotRevenuePage({
  params,
}: {
  readonly params: Promise<{ readonly depotId: string }>;
}) {
  const { depotId } = await params;
  // Layouts do not re-run on client navigation, so the page gates itself too;
  // the id is checked before the session gate sees it.
  await requireDepotPage(depotId, '/revenue');

  return (
    <>
      <PageHeader
        title="Revenue and ridership (modelled)"
        description="Trips, boardings and revenue by route for the operating date. The feed carries no ticketing, so every figure here is modelled from planning assumptions, not measured."
        provenance="modelled"
      />
      <Suspense fallback={<LoadingBlock rows={12} label="Loading the revenue view" />}>
        <RevenuePage />
      </Suspense>
    </>
  );
}
