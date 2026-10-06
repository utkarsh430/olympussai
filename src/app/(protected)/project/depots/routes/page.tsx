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
          // One short line, so the MIXED pill sits on it at 1440 (critique round 5, Must 4).
          // Dead km a trip is measured (depot position to terminals), so DERIVED, as the
          // column and the drawer say; only what is multiplied by modelled trips is MODELLED.
          // Where the derived figures come from is said in the closing disclosure.
          live: 'Buses on routes',
          derived: 'stops, terminals and dead km a trip',
          modelled: 'trips a day and daily dead km',
        }}
      />
      {/* RoutesPage reads the ?depot= scope (useSearchParams), so it sits in a boundary. */}
      <Suspense fallback={<StatePanel kind="loading" rows={10} sentence="Loading the routes" />}>
        <RoutesPage />
      </Suspense>
    </>
  );
}
