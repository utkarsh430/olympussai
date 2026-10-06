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
        description="Every route the live feed shows, and which depot should run each one so buses drive fewer empty kilometres to and from its terminals."
        provenance="derived"
      />
      <RoutesPage />
    </>
  );
}
