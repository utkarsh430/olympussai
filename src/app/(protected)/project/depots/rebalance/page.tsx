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
        description="Each depot's buses against its need, and the transfers that would close the gaps."
        provenanceLine={{
          default: 'mixed',
          live: 'Fleet, off-the-road and available counts',
          modelled: 'requirement, spare target, surplus, deficit and every transfer',
        }}
      />
      <RebalancePage />
    </>
  );
}
