import { Suspense } from 'react';
import { requireProjectSession } from '@/lib/auth/server';
import { ExceptionCentre } from '@/components/depot/exceptions/ExceptionCentre';
import { LoadingBlock } from '@/components/depot/shell/DataStates';
import { PageHeader } from '@/components/depot/shell/PageHeader';
import { EXCEPTIONS_PATH } from '@/lib/depot/nav';

/** Depots and buses that need attention, described with the numbers behind them. */
export default async function DepotExceptionsPage() {
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireProjectSession(EXCEPTIONS_PATH);

  return (
    <>
      <PageHeader
        title="Exceptions"
        description="Depots and buses that stand out now, each with the figures behind it."
        provenanceLine={{ default: 'derived' }}
      />
      {/* The centre reads its filters from the search parameters, which needs a boundary. */}
      <Suspense fallback={<LoadingBlock rows={8} label="Loading exceptions" />}>
        <ExceptionCentre />
      </Suspense>
    </>
  );
}
