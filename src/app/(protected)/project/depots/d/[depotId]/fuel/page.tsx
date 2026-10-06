import { Suspense } from 'react';
import { FuelPage } from '@/components/depot/fuel/FuelPage';
import { LoadingBlock } from '@/components/depot/shell/DataStates';
import { PageHeader } from '@/components/depot/shell/PageHeader';
import type { ProvenanceDescription } from '@/lib/depot/provenanceLine';
import { requireDepotPage } from '@/lib/depot/depotGate';
import { fuelHeader } from '@/lib/depot/fuel/fuelHeader';

/** The page default: every figure is MODELLED. */
const PROVENANCE: ProvenanceDescription = {
  default: 'modelled',
  replacedBy: 'fuel issue records and odometer readings',
  feedId: 'fuel',
};

/** Modelled fuel issued, kilometres per litre and cost per kilometre, and the buses that stand out. */
export default async function DepotFuelPage({
  params,
}: {
  readonly params: Promise<{ readonly depotId: string }>;
}) {
  const { depotId } = await params;
  // Layouts do not re-run on client navigation, so the page gates itself too;
  // the id is checked before the session gate sees it.
  await requireDepotPage(depotId, '/fuel');

  // The client page renders the header, so its provenance line can carry the dated day.
  return (
    <Suspense
      fallback={
        <>
          <PageHeader {...fuelHeader(PROVENANCE)} />
          <LoadingBlock rows={14} label="Loading the fuel and cost view" />
        </>
      }
    >
      <FuelPage provenance={PROVENANCE} />
    </Suspense>
  );
}
