import { requireProjectSession } from '@/lib/auth/server';
import { HEADWAYS_PATH } from '@/lib/depot/os/workspaces';
import { HeadwaysView } from '@/components/depot/os/network/HeadwaysView';

/** Headways and possible bunching across the network's routes. */
export default async function HeadwaysPage() {
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireProjectSession(HEADWAYS_PATH);
  return <HeadwaysView />;
}
