import { Suspense } from 'react';
import { requireProjectSession } from '@/lib/auth/server';
import { IncidentRollupPage } from '@/components/depot/incident/IncidentRollupPage';
import { LoadingBlock } from '@/components/depot/shell/DataStates';
import { PageHeader } from '@/components/depot/shell/PageHeader';
import { INCIDENTS_PATH } from '@/lib/depot/nav';
import { PAGE_TITLE, ROLLUP_DESCRIPTION } from '@/lib/depot/incident/incidentWording';

/** Headquarters' Incident Response: every depot's suspected breakdowns. */
export default async function IncidentsRoutePage() {
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireProjectSession(INCIDENTS_PATH);
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title={PAGE_TITLE} description={ROLLUP_DESCRIPTION} />
          <LoadingBlock rows={8} label="Loading the incidents" />
        </>
      }
    >
      <IncidentRollupPage />
    </Suspense>
  );
}
