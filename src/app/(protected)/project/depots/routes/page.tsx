import { Suspense } from 'react';
import { requireProjectSession } from '@/lib/auth/server';
import { RoutesPage } from '@/components/depot/routes/RoutesPage';
import { PageHeader } from '@/components/depot/shell/PageHeader';
import { StatePanel } from '@/components/depot/shell/StatePanel';

const ROUTES_PATH = '/project/depots/routes';

/** Every route in the live feed, and which depot should run each one to cut empty running. */
export default async function DepotRoutesPage() {
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireProjectSession(ROUTES_PATH);

  return (
    <>
      <PageHeader
        title="Routes"
        description="Every route in the feed, and which depot should run each one."
        provenanceLine={{
          default: 'mixed',
          live: 'Routes and the buses on them',
          // Dead km a trip is measured (depot position to terminals), so DERIVED, as the
          // column and the drawer say; only what is multiplied by modelled trips is MODELLED.
          derived:
            'stops, terminals and dead kilometres a trip, from the route-details feed and inferred depot positions,',
          modelled: 'trips a day and the daily dead kilometres built on them',
        }}
      />
      {/* RoutesPage reads the ?depot= scope (useSearchParams), so it sits in a boundary. */}
      <Suspense fallback={<StatePanel kind="loading" rows={10} sentence="Loading the routes" />}>
        <RoutesPage />
      </Suspense>
    </>
  );
}
