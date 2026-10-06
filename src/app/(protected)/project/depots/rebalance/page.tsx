import { requireProjectSession } from '@/lib/auth/server';
import { RebalancePage } from '@/components/depot/rebalance/RebalancePage';
import { PageHeader } from '@/components/depot/shell/PageHeader';

const REBALANCE_PATH = '/project/depots/rebalance';

/** Buses each depot has against the buses it needs, and the transfers recommended between them. */
export default async function FleetDistributionPage() {
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireProjectSession(REBALANCE_PATH);

  return (
    <>
      <PageHeader
        title="Fleet distribution"
        description="For every depot, the buses it has against the buses it needs, and the transfers between depots that the optimiser recommends."
        provenance="modelled"
      />
      <RebalancePage />
    </>
  );
}
