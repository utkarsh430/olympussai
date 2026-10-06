import { requireProjectSession } from '@/lib/auth/server';
import { EconomicsPage } from '@/components/depot/economics/EconomicsPage';

const ECONOMICS_PATH = '/project/depots/economics';

/**
 * Operating depots ranked by the modelled Depot Economics Index within peer groups.
 * The page component renders the header, so its MODELLED provenance line can carry
 * the dated modelled day once the response names it.
 */
export default async function DepotEconomicsPage() {
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireProjectSession(ECONOMICS_PATH);

  return <EconomicsPage />;
}
