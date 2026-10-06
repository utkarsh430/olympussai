import { Suspense } from 'react';
import { DutyPage } from '@/components/depot/duties/DutyPage';
import { LoadingBlock } from '@/components/depot/shell/DataStates';
import { PageHeader } from '@/components/depot/shell/PageHeader';
import { requireDepotPage } from '@/lib/depot/depotGate';

/** The day's modelled duties for one depot and the buses proposed for them. */
export default async function DepotDutiesPage({
  params,
}: {
  readonly params: Promise<{ readonly depotId: string }>;
}) {
  const { depotId } = await params;
  // Layouts do not re-run on client navigation, so the page gates itself too;
  // the id is checked before the session gate sees it.
  await requireDepotPage(depotId, '/duties');

  return (
    <>
      <PageHeader
        title="Duties"
        description="The day's duties for this depot and the buses a matching would put on them. Duties are modelled; bus states are live."
        provenance="modelled"
      />
      <Suspense fallback={<LoadingBlock rows={4} label="Loading the duty board" />}>
        <DutyPage depotId={depotId} />
      </Suspense>
    </>
  );
}
