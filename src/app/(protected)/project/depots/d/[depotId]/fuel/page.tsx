import { Suspense } from 'react';
import { FuelPage } from '@/components/depot/fuel/FuelPage';
import { LoadingBlock } from '@/components/depot/shell/DataStates';
import { PageHeader } from '@/components/depot/shell/PageHeader';
import { requireDepotPage } from '@/lib/depot/depotGate';

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

  return (
    <>
      <PageHeader
        title="Fuel and cost"
        description="Fuel issued and distance for the day, kilometres per litre and cost per kilometre by service class and route, and the buses whose use per kilometre stands out from their peers."
        provenance="modelled"
      />
      <Suspense fallback={<LoadingBlock rows={14} label="Loading the fuel and cost view" />}>
        <FuelPage />
      </Suspense>
    </>
  );
}
