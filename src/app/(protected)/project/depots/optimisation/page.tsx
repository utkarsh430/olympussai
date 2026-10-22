import { requireProjectSession } from '@/lib/auth/server';
import { OPTIMISATION_PATH } from '@/lib/depot/os/workspaces';
import { NetworkOptimisation } from '@/components/depot/os/network/NetworkOptimisation';

/** Combined network optimisation: depot balance and route-hour reallocation, before and after. */
export default async function NetworkOptimisationPage() {
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireProjectSession(OPTIMISATION_PATH);
  return <NetworkOptimisation />;
}
