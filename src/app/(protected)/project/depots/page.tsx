import { requireProjectSession } from '@/lib/auth/server';
import { DEPOTS_ROOT } from '@/lib/depot/nav';
import { MissionControl } from '@/components/depot/os/mission/MissionControl';

/** Control Room at Headquarters: the flagship view of Depot Intelligence OS. */
export default async function DepotsMissionControlPage() {
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireProjectSession(DEPOTS_ROOT);

  return <MissionControl />;
}
