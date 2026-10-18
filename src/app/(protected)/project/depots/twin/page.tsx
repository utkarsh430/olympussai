import { requireProjectSession } from '@/lib/auth/server';
import { TWIN_PATH } from '@/lib/depot/os/workspaces';
import { NetworkTwin } from '@/components/depot/os/performance/NetworkTwin';

/** The network's digital twin. */
export default async function NetworkTwinPage() {
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireProjectSession(TWIN_PATH);
  return <NetworkTwin />;
}
