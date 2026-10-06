import { requireProjectSession } from '@/lib/auth/server';
import { EconomicsPage } from '@/components/depot/economics/EconomicsPage';
import { PageHeader } from '@/components/depot/shell/PageHeader';

const ECONOMICS_PATH = '/project/depots/economics';

/** Operating depots ranked by the modelled Depot Economics Index within peer groups. */
export default async function DepotEconomicsPage() {
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireProjectSession(ECONOMICS_PATH);

  return (
    <>
      <PageHeader
        title="Economics"
        description="Depots ranked on earnings, fuel cost and load factor within peer groups."
        provenanceLine={{
          default: 'modelled',
          replacedBy: 'fuel issue records, odometer readings, a ticketing feed and a route master',
        }}
      />
      <EconomicsPage />
    </>
  );
}
