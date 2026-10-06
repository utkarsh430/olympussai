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
        description="The day's duties and the bus proposed for each; nothing is assigned or dispatched."
        provenanceLine={{
          default: 'mixed',
          live: 'Bus states',
          modelled: 'duties and the matching',
        }}
      />
      <Suspense fallback={<LoadingBlock rows={4} label="Loading the duty board" />}>
        <DutyPage depotId={depotId} />
      </Suspense>
    </>
  );
}
