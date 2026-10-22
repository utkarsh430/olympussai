import { DepotTwin } from '@/components/depot/os/performance/DepotTwin';
import { requireDepotPage } from '@/lib/depot/depotGate';

/** One depot's digital twin. */
export default async function DepotTwinPage({
  params,
}: {
  readonly params: Promise<{ depotId: string }>;
}) {
  const { depotId } = await params;
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireDepotPage(depotId, '/twin');
  return <DepotTwin />;
}
