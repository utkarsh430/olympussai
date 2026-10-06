import { YardPage } from '@/components/depot/yard/YardPage';
import { PageHeader } from '@/components/depot/shell/PageHeader';
import { requireDepotPage } from '@/lib/depot/depotGate';
import type { ProvenanceDescription } from '@/lib/depot/provenanceLine';

/**
 * MIXED: positions, states and the yard circle come from the live feed; capacity, the
 * lanes and the night parking order are generated. The capacity figure and the parking
 * section carry their own MODELLED tag beside real registrations.
 */
const YARD_PROVENANCE: ProvenanceDescription = {
  default: 'mixed',
  derived: 'Bus positions, states and the yard circle',
  modelled: 'capacity, lanes and the parking order',
};

/** Who is in this depot's yard right now, on a yard learned from where its buses park. */
export default async function DepotYardPage({
  params,
}: {
  readonly params: Promise<{ depotId: string }>;
}) {
  const { depotId } = await params;
  // Layouts do not re-run on client navigation, so the page gates itself too;
  // the id is checked before the session gate sees it.
  await requireDepotPage(depotId, '/yard');

  return (
    <>
      <PageHeader
        title="Yard"
        description="Who is in this depot's yard now, on a yard inferred from where buses park."
        provenanceLine={YARD_PROVENANCE}
      />
      <YardPage />
    </>
  );
}
