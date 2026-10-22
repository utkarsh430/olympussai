import { FleetHealthView } from '@/components/depot/os/reliability/FleetHealthView';
import { requireDepotPage } from '@/lib/depot/depotGate';

/** One depot's fleet health, predictive maintenance and repair-bay plan. */
export default async function DepotFleetHealthPage({
  params,
}: {
  readonly params: Promise<{ depotId: string }>;
}) {
  const { depotId } = await params;
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireDepotPage(depotId, '/health');
  return <FleetHealthView />;
}
