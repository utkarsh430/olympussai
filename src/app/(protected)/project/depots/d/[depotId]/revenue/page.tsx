import { Suspense } from 'react';
import { RevenuePage } from '@/components/depot/revenue/RevenuePage';
import { LoadingBlock } from '@/components/depot/shell/DataStates';
import { PageHeader } from '@/components/depot/shell/PageHeader';
import { requireDepotPage } from '@/lib/depot/depotGate';
import { revenueHeader } from '@/lib/depot/revenue/revenueHeader';

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

  // The client page renders the header, so its provenance line can carry the dated day.
  return (
    <Suspense
      fallback={
        <>
          <PageHeader {...revenueHeader()} />
          <LoadingBlock rows={12} label="Loading the revenue view" />
        </>
      }
    >
      <RevenuePage />
    </Suspense>
  );
}
