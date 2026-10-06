import { requireProjectSession } from '@/lib/auth/server';
import { RoutesPage } from '@/components/depot/routes/RoutesPage';
import { PageHeader } from '@/components/depot/shell/PageHeader';

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
          live: 'Routes and buses, and stops and terminals from the route-details feed',
          modelled: 'depot positions (inferred), trips and the dead kilometres built on them',
        }}
      />
      <RoutesPage />
    </>
  );
}
