import { DepotMissionControl } from '@/components/depot/os/mission/DepotMissionControl';
import { requireDepotPage } from '@/lib/depot/depotGate';

/** One depot's Control Room: readiness, departures, resources and its AI decisions. */
export default async function DepotMissionControlPage({
  params,
}: {
  readonly params: Promise<{ depotId: string }>;
}) {
  const { depotId } = await params;
  // Layouts do not re-run on client navigation, so the page gates itself too;
  // the id is checked before the session gate sees it.
  await requireDepotPage(depotId);

  return <DepotMissionControl />;
}
