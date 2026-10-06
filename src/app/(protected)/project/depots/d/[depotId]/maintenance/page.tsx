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
        description="What is off the road now, and what a model says is coming due for service."
        provenanceLine={{
          default: 'mixed',
          live: 'Off-road buses',
          modelled: 'service status and workshop bays',
        }}
      />
      <Suspense fallback={<LoadingBlock rows={12} label="Loading the maintenance view" />}>
        <MaintenancePage />
      </Suspense>
    </>
  );
}
