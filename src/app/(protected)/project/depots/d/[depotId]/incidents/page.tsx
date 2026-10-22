import { Suspense } from 'react';
import { IncidentHeader, IncidentPage } from '@/components/depot/incident/IncidentPage';
import { LoadingBlock } from '@/components/depot/shell/DataStates';
import { requireDepotPage } from '@/lib/depot/depotGate';

/** The depot's Incident Response: buses that may have broken down and the quickest way to move their passengers. */
export default async function DepotIncidentsPage({
  params,
}: {
  readonly params: Promise<{ readonly depotId: string }>;
}) {
  const { depotId } = await params;
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireDepotPage(depotId, '/incidents');
  return (
    <Suspense
      fallback={
        <>
          <IncidentHeader />
          <LoadingBlock rows={8} label="Loading the incidents" />
        </>
      }
    >
      <IncidentPage />
    </Suspense>
  );
}
