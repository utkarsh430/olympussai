import { Suspense } from 'react';
import { MaintenancePage } from '@/components/depot/maintenance/MaintenancePage';
import { LoadingBlock } from '@/components/depot/shell/DataStates';
import { PageHeader } from '@/components/depot/shell/PageHeader';
import { requireDepotPage } from '@/lib/depot/depotGate';

/** What is off the road now, what is coming due for service, and the workshop's load. */
export default async function DepotMaintenancePage({
  params,
}: {
  readonly params: Promise<{ readonly depotId: string }>;
}) {
  const { depotId } = await params;
  // Layouts do not re-run on client navigation, so the page gates itself too;
  // the id is checked before the session gate sees it.
  await requireDepotPage(depotId, '/maintenance');

  return (
    <>
      <PageHeader
        title="Maintenance"
        description="Buses the feed reports under maintenance, preventive services coming due on a modelled history, and the workshop's load. Nothing here is written back to any system."
      />
      <Suspense fallback={<LoadingBlock rows={12} label="Loading the maintenance view" />}>
        <MaintenancePage />
      </Suspense>
    </>
  );
}
