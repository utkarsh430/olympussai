import { requireProjectSession } from '@/lib/auth/server';
import { RELIABILITY_PATH } from '@/lib/depot/os/workspaces';
import { FleetHealthView } from '@/components/depot/os/reliability/FleetHealthView';

/** Fleet health across Headquarters (or the chosen region). */
export default async function FleetHealthPage() {
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireProjectSession(RELIABILITY_PATH);
  return <FleetHealthView />;
}
