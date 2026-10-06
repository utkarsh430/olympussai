import { Suspense } from 'react';
import { requireProjectSession } from '@/lib/auth/server';
import { DutyPage } from '@/components/depot/duties/DutyPage';
import { LoadingBlock } from '@/components/depot/shell/DataStates';
import { PageHeader } from '@/components/depot/shell/PageHeader';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';

/** The day's modelled duties for one depot and the buses proposed for them. */
export default async function DepotDutiesPage({
  params,
}: {
  readonly params: Promise<{ readonly depotId: string }>;
}) {
  const { depotId } = await params;
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireProjectSession(`/project/depots/d/${depotId}/duties`);

  return (
    <>
      <PageHeader
        title="Duties"
        description="The day's duties for this depot and the buses a matching would put on them. Duties are modelled; bus states are live."
      >
        <ProvenanceBadge provenance="modelled" />
      </PageHeader>
      <Suspense fallback={<LoadingBlock rows={4} label="Loading the duty board" />}>
        <DutyPage depotId={depotId} />
      </Suspense>
    </>
  );
}
