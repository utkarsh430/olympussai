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
        title="Economics (modelled)"
        description="Depots ranked by a modelled index of earnings per kilometre, fuel cost per kilometre and load factor, within peer groups of similar fleet size. The feed carries no ticketing, so every figure is modelled, not measured."
        provenance="modelled"
      />
      <EconomicsPage />
    </>
  );
}
