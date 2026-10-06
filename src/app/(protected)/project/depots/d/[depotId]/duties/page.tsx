import { Suspense } from 'react';
import { DutiesHeader } from '@/components/depot/duties/DutiesHeader';
import { DutiesLoading, DutyPage } from '@/components/depot/duties/DutyPage';
import { requireDepotPage } from '@/lib/depot/depotGate';

/** The day's modelled duties for one depot and the bus matched to each. */
export default async function DepotDutiesPage({
  params,
}: {
  readonly params: Promise<{ readonly depotId: string }>;
}) {
  const { depotId } = await params;
  // Layouts do not re-run on client navigation, so the page gates itself too;
  // the id is checked before the session gate sees it.
  await requireDepotPage(depotId, '/duties');

  // The header renders inside DutyPage, so the provenance line can carry the dated
  // modelled-day sentence once the board has loaded.
  return (
    <Suspense
      fallback={
        <>
          <DutiesHeader />
          <DutiesLoading />
        </>
      }
    >
      <DutyPage depotId={depotId} />
    </Suspense>
  );
}
